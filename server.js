const http = require("node:http");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const nodemailer = require("nodemailer");

const root = __dirname;

// Необязательный .env рядом с server.js — удобно для настройки на VPS.
(function loadEnvFile() {
    let content;
    try {
        content = fsSync.readFileSync(path.join(root, ".env"), "utf8");
    } catch {
        return;
    }
    for (const line of content.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!match || line.trimStart().startsWith("#")) {
            continue;
        }
        let value = match[2];
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (process.env[match[1]] === undefined) {
            process.env[match[1]] = value;
        }
    }
})();
const usersFile = process.env.SDONATE_USERS_FILE || path.join(root, "data", "users.json");
const verificationsFile = process.env.SDONATE_VERIFICATIONS_FILE || path.join(root, "data", "verifications.json");
const passwordResetsFile = process.env.SDONATE_PASSWORD_RESETS_FILE || path.join(root, "data", "password-resets.json");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
let adminEmail = normalizeEmail(process.env.SDONATE_ADMIN_EMAIL || "");
const adminNickname = String(process.env.SDONATE_ADMIN_NICKNAME || "Andrey11").trim() || "Andrey11";
const adminPassword = process.env.SDONATE_ADMIN_PASSWORD || "";
const telegramToken = process.env.SDONATE_TELEGRAM_BOT_TOKEN || "";
const telegramChatId = process.env.SDONATE_TELEGRAM_CHAT_ID || "";
const telegramConfigured = Boolean(telegramToken && telegramChatId);
const configuredPublicBaseUrl = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const smtpFrom = process.env.SMTP_FROM || smtpUser || "noreply@localhost";
const recaptchaSiteKey = process.env.RECAPTCHA_SITE_KEY || "";
const recaptchaSecretKey = process.env.RECAPTCHA_SECRET_KEY || "";
const recaptchaEnabled = Boolean(recaptchaSiteKey && recaptchaSecretKey);
const passwordResetLifetimeMs = 60 * 60 * 1000;
const sessionLifetime = 8 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();
let userWriteQueue = Promise.resolve();
let verificationWriteQueue = Promise.resolve();
let telegramUpdateOffset = 0;
const protectedPages = new Set([
    "dashboard.html",
    "finance.html",
    "settings.html",
    "shops.html",
    "shop-create.html",
    "shop-dashboard.html",
    "servers.html",
    "store-settings.html",
    "store-images.html",
    "store-templates.html",
    "store-products.html",
    "store-tools.html"
]);
const mimeTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".jar": "application/java-archive",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp"
};

function normalizeEmail(email) {
    return String(email).trim().toLowerCase();
}

function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, 64, (error, derivedKey) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(`${salt}:${derivedKey.toString("hex")}`);
        });
    });
}

async function verifyPassword(password, storedHash) {
    const [salt, expectedHex] = String(storedHash).split(":");
    if (!salt || !/^[a-f0-9]{128}$/i.test(expectedHex || "")) {
        return false;
    }
    const actual = Buffer.from(await passwordHash(password, salt).then(value => value.split(":")[1]), "hex");
    const expected = Buffer.from(expectedHex, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function readUsers() {
    try {
        const users = JSON.parse(await fs.readFile(usersFile, "utf8"));
        if (!Array.isArray(users) || users.some(user =>
            !user || typeof user.id !== "string" || typeof user.email !== "string" ||
            typeof user.nickname !== "string" || typeof user.passwordHash !== "string" ||
                !["admin", "user"].includes(user.role) ||
                (user.active !== undefined && typeof user.active !== "boolean")
        )) {
            throw new Error("User database has an invalid format.");
        }
        return users;
    } catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}

async function writeUsers(users) {
    await fs.mkdir(path.dirname(usersFile), { recursive: true });
    const temporaryFile = `${usersFile}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(users, null, 2), { mode: 0o600 });
    await fs.rename(temporaryFile, usersFile);
}

function updateUsers(update) {
    const operation = userWriteQueue.then(async () => {
        const users = await readUsers();
        const result = await update(users);
        await writeUsers(users);
        return result;
    });
    userWriteQueue = operation.catch(() => {});
    return operation;
}

async function readVerifications() {
    try {
        const records = JSON.parse(await fs.readFile(verificationsFile, "utf8"));
        if (!Array.isArray(records) || records.some(record =>
            !record || typeof record.id !== "string" || typeof record.userId !== "string" ||
            typeof record.surname !== "string" || typeof record.firstName !== "string" ||
            typeof record.patronymic !== "string" || typeof record.phone !== "string" ||
            !["pending", "approved", "rejected"].includes(record.status) ||
            typeof record.createdAt !== "string"
        )) {
            throw new Error("Verification database has an invalid format.");
        }
        return records;
    } catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}

async function writeVerifications(records) {
    await fs.mkdir(path.dirname(verificationsFile), { recursive: true });
    const temporaryFile = `${verificationsFile}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(records, null, 2), { mode: 0o600 });
    await fs.rename(temporaryFile, verificationsFile);
}

async function readPasswordResets() {
    try {
        const records = JSON.parse(await fs.readFile(passwordResetsFile, "utf8"));
        if (!Array.isArray(records)) {
            throw new Error("Password reset database has an invalid format.");
        }
        return records;
    } catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}

async function writePasswordResets(records) {
    await fs.mkdir(path.dirname(passwordResetsFile), { recursive: true });
    const temporaryFile = `${passwordResetsFile}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(records, null, 2), { mode: 0o600 });
    await fs.rename(temporaryFile, passwordResetsFile);
}

function updatePasswordResets(update) {
    const operation = verificationWriteQueue.then(async () => {
        const records = await readPasswordResets();
        const result = await update(records);
        await writePasswordResets(Array.isArray(result) ? result : records);
        return result;
    });
    verificationWriteQueue = operation.catch(() => {});
    return operation;
}

function getSmtpTransporter() {
    if (!smtpHost || !smtpUser || !smtpPass) {
        return null;
    }
    return nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass }
    });
}

async function sendPasswordResetEmail(email, token, request) {
    const resetUrl = `${getPublicBaseUrl(request)}/reset-password.html?token=${encodeURIComponent(token)}`;
    const transporter = getSmtpTransporter();
    if (!transporter) {
        console.warn(`Password reset requested for ${email}. Dev reset URL: ${resetUrl}`);
        return { devMode: true, resetUrl };
    }

    await transporter.sendMail({
        from: smtpFrom,
        to: email,
        subject: "Восстановление пароля SDonate",
        html: `
            <div style="font-family: Arial, sans-serif; color: #111827;">
                <h2>Восстановление пароля</h2>
                <p>Нажмите на кнопку ниже, чтобы установить новый пароль:</p>
                <p><a href="${resetUrl}" style="display: inline-block; padding: 12px 16px; background: #111827; color: white; border-radius: 8px; text-decoration: none;">Сбросить пароль</a></p>
                <p>Если вы не запрашивали сброс, просто проигнорируйте это письмо.</p>
                <p>Ссылка действительна 1 час.</p>
            </div>
        `
    });
    return { devMode: false, resetUrl };
}

async function requestPasswordReset(email, request) {
    const normalizedEmail = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return { ok: false, error: "Укажи корректный адрес электронной почты." };
    }

    const users = await readUsers();
    const user = users.find(candidate => candidate.email === normalizedEmail && candidate.active !== false);
    if (!user) {
        return { ok: true, generic: true };
    }

    const token = crypto.randomBytes(32).toString("hex");
    const reset = {
        id: crypto.randomUUID(),
        userId: user.id,
        email: normalizedEmail,
        token,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + passwordResetLifetimeMs).toISOString()
    };

    await updatePasswordResets(records => {
        const filtered = records.filter(candidate => candidate.email !== normalizedEmail && candidate.userId !== user.id);
        filtered.push(reset);
        return filtered;
    });

    const result = await sendPasswordResetEmail(normalizedEmail, token, request);
    return { ok: true, generic: false, resetUrl: result.resetUrl, devMode: result.devMode };
}

async function consumePasswordResetToken(token, newPassword) {
    if (!token || typeof token !== "string") {
        return { ok: false, status: 400, error: "Токен сброса не найден." };
    }
    if (typeof newPassword !== "string" || newPassword.length < 8 || Buffer.byteLength(newPassword, "utf8") > 1024) {
        return { ok: false, status: 400, error: "Пароль должен содержать от 8 до 1024 байт." };
    }

    const records = await readPasswordResets();
    const record = records.find(candidate => candidate.token === token);
    if (!record) {
        return { ok: false, status: 404, error: "Ссылка для сброса недействительна или уже использована." };
    }
    if (new Date(record.expiresAt).getTime() <= Date.now()) {
        await updatePasswordResets(current => current.filter(candidate => candidate.id !== record.id));
        return { ok: false, status: 410, error: "Срок действия ссылки истёк. Запросите повторно." };
    }

    const users = await readUsers();
    const userIndex = users.findIndex(candidate => candidate.id === record.userId);
    if (userIndex < 0) {
        await updatePasswordResets(current => current.filter(candidate => candidate.id !== record.id));
        return { ok: false, status: 404, error: "Аккаунт не найден." };
    }

    users[userIndex].passwordHash = await passwordHash(newPassword);
    await writeUsers(users);
    await updatePasswordResets(current => current.filter(candidate => candidate.id !== record.id));
    return { ok: true, userId: users[userIndex].id };
}

function updateVerifications(update) {
    const operation = verificationWriteQueue.then(async () => {
        const records = await readVerifications();
        const result = await update(records);
        await writeVerifications(records);
        return result;
    });
    verificationWriteQueue = operation.catch(() => {});
    return operation;
}

function setVerificationStatus(requestId, status) {
    return updateVerifications(records => {
        const record = records.find(candidate => candidate.id === requestId);
        if (!record) {
            return { state: "missing" };
        }
        if (record.status !== "pending") {
            return { state: "already-decided", record };
        }
        record.status = status;
        record.updatedAt = new Date().toISOString();
        return { state: "updated", record };
    });
}

async function telegramRequest(method, payload) {
    const response = await fetch(`https://api.telegram.org/bot${telegramToken}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(35_000)
    });
    if (!response.ok) {
        throw new Error(`Telegram API returned HTTP ${response.status}.`);
    }
    const result = await response.json();
    if (!result.ok) {
        throw new Error(`Telegram API rejected ${method}: ${result.description || "unknown error"}.`);
    }
    return result.result;
}

async function notifyVerificationRequest(record) {
    return telegramRequest("sendMessage", {
        chat_id: telegramChatId,
        text: `Новая заявка на верификацию №${record.id}\nЛичные данные доступны только в админ-панели SDonate.`,
        reply_markup: {
            inline_keyboard: [[
                { text: "Одобрить", callback_data: `vr:${record.id}:approve` },
                { text: "Отклонить", callback_data: `vr:${record.id}:reject` }
            ]]
        }
    });
}

async function handleTelegramUpdate(update) {
    const callback = update.callback_query;
    if (!callback) {
        return;
    }

    const match = String(callback.data || "").match(/^vr:([0-9a-f-]{36}):(approve|reject)$/i);
    const chat = callback.message && callback.message.chat;
    const isAuthorized = chat && chat.type === "private" &&
        String(chat.id) === telegramChatId && String(callback.from && callback.from.id) === telegramChatId;
    if (!isAuthorized || !match) {
        await telegramRequest("answerCallbackQuery", {
            callback_query_id: callback.id,
            text: "Действие недоступно."
        });
        return;
    }

    const newStatus = match[2] === "approve" ? "approved" : "rejected";
    const result = await setVerificationStatus(match[1], newStatus);
    if (result.state !== "updated") {
        await telegramRequest("answerCallbackQuery", {
            callback_query_id: callback.id,
            text: result.state === "missing" ? "Заявка не найдена." : "Заявка уже рассмотрена."
        });
        return;
    }

    const statusText = newStatus === "approved" ? "одобрена" : "отклонена";
    await telegramRequest("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: `Заявка ${statusText}.`
    });
    await telegramRequest("editMessageText", {
        chat_id: telegramChatId,
        message_id: callback.message.message_id,
        text: `Заявка на верификацию №${result.record.id} ${statusText}.`,
        reply_markup: { inline_keyboard: [] }
    });
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function pollTelegramUpdates() {
    while (true) {
        try {
            const updates = await telegramRequest("getUpdates", {
                offset: telegramUpdateOffset,
                timeout: 25,
                allowed_updates: ["callback_query"]
            });
            for (const update of updates) {
                await handleTelegramUpdate(update);
                telegramUpdateOffset = update.update_id + 1;
            }
        } catch (error) {
            console.error(`Telegram polling failed; retrying in 5 seconds: ${error.message}`);
            await delay(5000);
        }
    }
}

async function bootstrapAdmin() {
    const users = await readUsers();
    const existingAdmin = users.find(user => user.role === "admin");
    if (!adminEmail && existingAdmin) {
        adminEmail = existingAdmin.email;
    }
    if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
        throw new Error("Set SDONATE_ADMIN_EMAIL to a valid administrator email for first setup.");
    }
    const existing = users.find(user => user.email === adminEmail);
    if (existing) {
        if (existing.role !== "admin") {
            throw new Error("Configured administrator email already belongs to a non-admin account.");
        }
        if (existingAdmin && existingAdmin.email !== adminEmail) {
            throw new Error("The configured administrator email does not match the existing admin account.");
        }
        if (existing.nickname !== adminNickname) {
            existing.nickname = adminNickname;
            await writeUsers(users);
            console.log(`Administrator nickname updated to ${adminNickname}.`);
        }
        return;
    }
    if (existingAdmin) {
        throw new Error("Only one admin account is supported; configured email does not match it.");
    }
    if (adminPassword.length < 12) {
        throw new Error("For first setup, set SDONATE_ADMIN_PASSWORD to a new password of at least 12 characters.");
    }

    users.push({
        id: crypto.randomUUID(),
        nickname: adminNickname,
        email: adminEmail,
        passwordHash: await passwordHash(adminPassword),
        role: "admin",
        active: true,
        createdAt: new Date().toISOString()
    });
    await writeUsers(users);
    console.log("Initial administrator account created from environment configuration.");
}

function sendJson(response, status, data, headers = {}) {
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...headers
    });
    response.end(JSON.stringify(data));
}

function parseCookies(request) {
    return Object.fromEntries((request.headers.cookie || "").split(";").map(part => {
        const separator = part.indexOf("=");
        return separator < 0 ? ["", ""] : [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
    }).filter(([name]) => name));
}

function getSession(request) {
    const sessionId = parseCookies(request).sdonate_session;
    const session = sessionId && sessions.get(sessionId);
    if (!session || session.expiresAt <= Date.now()) {
        if (sessionId) {
            sessions.delete(sessionId);
        }
        return null;
    }
    session.expiresAt = Date.now() + sessionLifetime;
    return session;
}

function isSecureRequest(request) {
    if (request.socket.encrypted) {
        return true;
    }
    const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
    return forwardedProto === "https";
}

function getPublicBaseUrl(request) {
    if (configuredPublicBaseUrl) {
        return configuredPublicBaseUrl;
    }
    if (request) {
        const forwardedHost = String(request.headers["x-forwarded-host"] || "").split(",")[0].trim();
        const requestHost = forwardedHost || String(request.headers.host || "").trim();
        if (requestHost) {
            return `${isSecureRequest(request) ? "https" : "http"}://${requestHost}`;
        }
    }
    return `http://localhost:${port}`;
}

function setSessionCookie(request, response, sessionId, maxAge) {
    const isSecureContext = isSecureRequest(request);
    const cookieParts = [
        `sdonate_session=${encodeURIComponent(sessionId)}`,
        "HttpOnly",
        "Path=/",
        `Max-Age=${maxAge}`,
        "SameSite=Lax"
    ];
    if (isSecureContext) {
        cookieParts.push("Secure");
    }
    response.setHeader("Set-Cookie", cookieParts.join("; "));
}

function isSameOrigin(request) {
    const origin = request.headers.origin;
    if (!origin) {
        return true;
    }
    try {
        return new URL(origin).host === request.headers.host;
    } catch {
        return false;
    }
}

async function readJson(request) {
    let body = "";
    for await (const chunk of request) {
        body += chunk;
        if (body.length > 16 * 1024) {
            const error = new Error("Request body is too large.");
            error.status = 413;
            throw error;
        }
    }
    try {
        return JSON.parse(body || "{}");
    } catch {
        const error = new Error("Request body must be valid JSON.");
        error.status = 400;
        throw error;
    }
}

async function verifyRecaptcha(token, remoteAddress) {
    if (!recaptchaEnabled) {
        return true;
    }
    if (!token || typeof token !== "string" || token.length > 4096) {
        return false;
    }
    try {
        const params = new URLSearchParams({
            secret: recaptchaSecretKey,
            response: token
        });
        if (remoteAddress) {
            params.set("remoteip", remoteAddress);
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const verification = await fetch("https://www.google.com/recaptcha/api/siteverify", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: params.toString(),
                signal: controller.signal
            });
            if (!verification.ok) {
                return false;
            }
            const result = await verification.json();
            return result.success === true;
        } finally {
            clearTimeout(timeout);
        }
    } catch (error) {
        console.error(`reCAPTCHA verification failed: ${error.message}`);
        return false;
    }
}

function isAdminAccount(user) {
    return user.role === "admin" && normalizeEmail(user.email) === adminEmail;
}

function publicUser(user) {
    return {
        id: user.id,
        nickname: user.nickname,
        email: user.email,
        role: user.role,
        isAdmin: isAdminAccount(user)
    };
}

function requireAdmin(request, response) {
    const session = getSession(request);
    if (!session) {
        sendJson(response, 401, { error: "Требуется вход в аккаунт." });
        return null;
    }
    if (!isAdminAccount(session)) {
        sendJson(response, 403, { error: "Доступ разрешён только администратору." });
        return null;
    }
    return session;
}

async function handleApi(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/auth/me") {
        const session = getSession(request);
        if (!session) {
            sendJson(response, 401, { error: "Войдите в аккаунт." });
            return;
        }
        sendJson(response, 200, { user: publicUser(session) });
        return;
    }

    if (!["GET", "HEAD"].includes(request.method) && !isSameOrigin(request)) {
        sendJson(response, 403, { error: "Запрос с другого источника отклонён." });
        return;
    }

    if (url.pathname === "/api/verification" && ["GET", "POST"].includes(request.method)) {
        const session = getSession(request);
        if (!session) {
            sendJson(response, 401, { error: "Войдите в аккаунт." });
            return;
        }

        if (request.method === "GET") {
            const records = await readVerifications();
            const record = records
                .filter(candidate => candidate.userId === session.id)
                .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
            sendJson(response, 200, {
                telegramConfigured,
                request: record || null
            });
            return;
        }

        const input = await readJson(request);
        const surname = String(input.surname || "").trim();
        const firstName = String(input.firstName || "").trim();
        const patronymic = String(input.patronymic || "").trim();
        const phone = String(input.phone || "").trim();
        const validName = value => value.length <= 64 &&
            /^[\p{L}][\p{L}\p{M}\s'’-]*$/u.test(value);
        const phoneDigits = phone.replace(/\D/g, "");
        if (!validName(surname) || !validName(firstName) || !validName(patronymic)) {
            sendJson(response, 400, { error: "Проверь ФИО: используй буквы, пробелы или дефис (до 64 символов в каждом поле)." });
            return;
        }
        if (!/^\+?[\d\s().-]{7,24}$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
            sendJson(response, 400, { error: "Укажи корректный номер телефона." });
            return;
        }
        if (input.consent !== true) {
            sendJson(response, 400, { error: "Для отправки заявки необходимо согласие на обработку данных." });
            return;
        }

        const now = new Date().toISOString();
        const record = {
            id: crypto.randomUUID(),
            userId: session.id,
            surname,
            firstName,
            patronymic,
            phone,
            status: "pending",
            consentedAt: now,
            createdAt: now,
            updatedAt: now
        };
        const result = await updateVerifications(records => {
            const userRecords = records
                .filter(candidate => candidate.userId === session.id)
                .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
            if (userRecords[0] && userRecords[0].status === "approved") {
                return { state: "already-approved" };
            }
            if (userRecords.some(candidate => candidate.status === "pending")) {
                return { state: "already-pending" };
            }
            records.push(record);
            return { state: "created", record };
        });
        if (result.state === "already-approved") {
            sendJson(response, 409, { error: "Верификация этого аккаунта уже одобрена." });
            return;
        }
        if (result.state === "already-pending") {
            sendJson(response, 409, { error: "У тебя уже есть заявка на рассмотрении." });
            return;
        }

        let notificationSent = false;
        let notificationError = null;
        if (telegramConfigured) {
            try {
                await notifyVerificationRequest(record);
                notificationSent = true;
            } catch (error) {
                notificationError = "Заявка сохранена, но уведомление Telegram отправить не удалось.";
                console.error(`Telegram verification notification failed: ${error.message}`);
            }
        }
        sendJson(response, 201, {
            request: record,
            telegramConfigured,
            notificationSent,
            notificationError
        });
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/verifications") {
        if (!requireAdmin(request, response)) {
            return;
        }
        const [records, users] = await Promise.all([readVerifications(), readUsers()]);
        const accounts = new Map(users.map(user => [user.id, user]));
        const requests = records
            .slice()
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            .map(record => ({
                ...record,
                nickname: accounts.get(record.userId)?.nickname || "Удалённый аккаунт",
                email: accounts.get(record.userId)?.email || ""
            }));
        sendJson(response, 200, { requests, telegramConfigured });
        return;
    }

    const verificationDecisionMatch = url.pathname.match(/^\/api\/admin\/verifications\/([0-9a-f-]{36})\/decision$/i);
    if (request.method === "POST" && verificationDecisionMatch) {
        if (!requireAdmin(request, response)) {
            return;
        }
        const input = await readJson(request);
        if (!["approved", "rejected"].includes(input.status)) {
            sendJson(response, 400, { error: "Укажи решение по заявке." });
            return;
        }
        const result = await setVerificationStatus(verificationDecisionMatch[1], input.status);
        if (result.state === "missing") {
            sendJson(response, 404, { error: "Заявка не найдена." });
            return;
        }
        if (result.state === "already-decided") {
            sendJson(response, 409, { error: "Эта заявка уже рассмотрена." });
            return;
        }
        sendJson(response, 200, { request: result.record });
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/auth/captcha-config") {
        sendJson(response, 200, { enabled: recaptchaEnabled, siteKey: recaptchaEnabled ? recaptchaSiteKey : null });
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/register") {
        const input = await readJson(request);
        if (!await verifyRecaptcha(input.recaptchaToken, request.socket.remoteAddress)) {
            sendJson(response, 400, { error: "Подтверди, что ты не робот.", captchaFailed: true });
            return;
        }
        const nickname = String(input.nickname || "").trim();
        const email = normalizeEmail(input.email || "");
        const password = String(input.password || "");
        if (!/^[A-Za-z0-9_]{3,16}$/.test(nickname)) {
            sendJson(response, 400, { error: "Ник должен содержать 3–16 символов: латинские буквы, цифры или _." });
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            sendJson(response, 400, { error: "Укажи корректный адрес электронной почты." });
            return;
        }
        if (email === adminEmail) {
            sendJson(response, 409, { error: "Этот адрес зарезервирован для администратора." });
            return;
        }
        if (password.length < 8 || Buffer.byteLength(password, "utf8") > 1024) {
            sendJson(response, 400, { error: "Пароль должен содержать от 8 до 1024 байт." });
            return;
        }
        const user = await updateUsers(async users => {
            if (users.some(candidate => candidate.email === email)) {
                return null;
            }
            const newUser = {
                id: crypto.randomUUID(),
                nickname,
                email,
                passwordHash: await passwordHash(password),
                role: "user",
                active: true,
                createdAt: new Date().toISOString()
            };
            users.push(newUser);
            return newUser;
        });
        if (!user) {
            sendJson(response, 409, { error: "Аккаунт с такой почтой уже существует." });
            return;
        }
        const sessionId = crypto.randomBytes(32).toString("hex");
        sessions.set(sessionId, { ...publicUser(user), expiresAt: Date.now() + sessionLifetime });
        setSessionCookie(request, response, sessionId, sessionLifetime / 1000);
        sendJson(response, 201, { user: publicUser(user) });
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/login") {
        const address = request.socket.remoteAddress || "unknown";
        const attempts = loginAttempts.get(address) || { count: 0, blockedUntil: 0 };
        if (attempts.blockedUntil > Date.now()) {
            sendJson(response, 429, { error: "Слишком много попыток входа. Попробуй позже." });
            return;
        }

        const input = await readJson(request);
        if (!await verifyRecaptcha(input.recaptchaToken, request.socket.remoteAddress)) {
            sendJson(response, 400, { error: "Подтверди, что ты не робот.", captchaFailed: true });
            return;
        }
        const email = normalizeEmail(input.email || "");
        const password = String(input.password || "");
        const users = await readUsers();
        const user = users.find(candidate => candidate.email === email);
        const valid = user ? await verifyPassword(password, user.passwordHash) : false;
        if (!valid || user.active === false) {
            attempts.count += 1;
            if (attempts.count >= 8) {
                attempts.count = 0;
                attempts.blockedUntil = Date.now() + 15 * 60 * 1000;
            }
            loginAttempts.set(address, attempts);
            sendJson(response, 401, { error: "Неверная почта или пароль." });
            return;
        }

        loginAttempts.delete(address);
        const sessionId = crypto.randomBytes(32).toString("hex");
        sessions.set(sessionId, { ...publicUser(user), expiresAt: Date.now() + sessionLifetime });
        setSessionCookie(request, response, sessionId, sessionLifetime / 1000);
        sendJson(response, 200, { user: publicUser(user) });
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/request-password-reset") {
        const input = await readJson(request);
        const email = normalizeEmail(input.email || "");
        const result = await requestPasswordReset(email, request);
        if (!result.ok) {
            sendJson(response, 400, { error: result.error });
            return;
        }
        sendJson(response, 200, {
            ok: true,
            message: "Если аккаунт существует, ссылка для сброса пароля отправлена на почту.",
            devMode: Boolean(result.devMode),
            resetUrl: result.resetUrl
        });
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/reset-password") {
        const input = await readJson(request);
        const token = String(input.token || "");
        const newPassword = String(input.password || "");
        const result = await consumePasswordResetToken(token, newPassword);
        if (!result.ok) {
            sendJson(response, result.status || 400, { error: result.error });
            return;
        }
        sendJson(response, 200, { ok: true, message: "Пароль успешно обновлён." });
        return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        const sessionId = parseCookies(request).sdonate_session;
        if (sessionId) {
            sessions.delete(sessionId);
        }
        setSessionCookie(request, response, "", 0);
        sendJson(response, 200, { ok: true });
        return;
    }

    if (request.method === "GET" && url.pathname === "/api/admin/summary") {
        if (!requireAdmin(request, response)) {
            return;
        }
        const users = await readUsers();
        sendJson(response, 200, {
            accounts: users.map(user => ({
                id: user.id,
                nickname: user.nickname,
                email: user.email,
                role: user.role,
                active: user.active !== false,
                createdAt: user.createdAt,
                shopCount: 0
            })),
            revenue: 0,
            turnover: 0,
            paymentsConnected: false
        });
        return;
    }

    const accountMatch = url.pathname.match(/^\/api\/admin\/accounts\/([0-9a-f-]+)$/i);
    if (accountMatch && ["PATCH", "DELETE"].includes(request.method)) {
        const admin = requireAdmin(request, response);
        if (!admin) {
            return;
        }
        const accountId = accountMatch[1];
        const result = await updateUsers(users => {
            const index = users.findIndex(user => user.id === accountId);
            if (index < 0) {
                return { error: "Аккаунт не найден.", status: 404 };
            }
            if (users[index].role === "admin") {
                return { error: "Администраторскую учётную запись нельзя изменить из этой панели.", status: 403 };
            }

            if (request.method === "DELETE") {
                const [deleted] = users.splice(index, 1);
                return { status: 200, account: { id: deleted.id } };
            }

            return readJson(request).then(input => {
                if (typeof input.active !== "boolean") {
                    return { error: "Укажи новый статус аккаунта.", status: 400 };
                }
                users[index].active = input.active;
                return { status: 200, account: { id: users[index].id, active: users[index].active } };
            });
        });
        if (result.status >= 400) {
            sendJson(response, result.status, { error: result.error });
            return;
        }

        if (request.method === "DELETE" || result.account.active === false) {
            for (const [sessionId, session] of sessions) {
                if (session.id === accountId) {
                    sessions.delete(sessionId);
                }
            }
        }
        sendJson(response, result.status, { account: result.account });
        return;
    }

    sendJson(response, 404, { error: "API endpoint not found." });
}

async function serveStatic(request, response, url) {
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(url.pathname);
    } catch {
        response.writeHead(400).end("Bad request");
        return;
    }

    if (decodedPath === "/login") {
        response.writeHead(302, { Location: "/reg.html?mode=login" }).end();
        return;
    }
    if (decodedPath === "/register") {
        response.writeHead(302, { Location: "/reg.html?mode=register" }).end();
        return;
    }
    if (decodedPath === "/auth") {
        const mode = url.searchParams.get("mode") === "register" ? "register" : "login";
        response.writeHead(302, { Location: `/reg.html?mode=${mode}` }).end();
        return;
    }

    const relativePath = decodedPath === "/" ? "index.html" : decodedPath === "/reg.html" ? "reg.html" : decodedPath.replace(/^\/+/, "");
    const filePath = path.resolve(root, relativePath);
    const pluginDownloadPath = path.join("downloads", "SdPlayments-0.1.0-SNAPSHOT.jar");
    const isPluginDownload = path.relative(root, filePath) === pluginDownloadPath;
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
    }
    if (path.relative(root, filePath).split(path.sep).some(segment =>
        segment.startsWith(".") || segment.toLowerCase().replace(/[ .]+$/g, "") === "data"
    )) {
        response.writeHead(404).end("Not found");
        return;
    }
    if (["server.js", "package.json", "package-lock.json"].includes(path.basename(filePath).toLowerCase())) {
        response.writeHead(404).end("Not found");
        return;
    }
    if (!Object.hasOwn(mimeTypes, path.extname(filePath).toLowerCase())) {
        response.writeHead(404).end("Not found");
        return;
    }
    if (path.extname(filePath).toLowerCase() === ".jar" && !isPluginDownload) {
        response.writeHead(404).end("Not found");
        return;
    }

    const pageName = path.basename(filePath).toLowerCase();
    if (pageName === "admin.html" || protectedPages.has(pageName) || isPluginDownload) {
        const session = getSession(request);
        if (!session) {
            response.writeHead(302, { Location: "/auth?mode=login" }).end();
            return;
        }
        if (pageName === "admin.html" && !isAdminAccount(session)) {
            response.writeHead(302, { Location: "/dashboard.html" }).end();
            return;
        }
    }

    try {
        const content = await fs.readFile(filePath);
        response.writeHead(200, {
            "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
            ...(isPluginDownload ? {
                "Content-Disposition": 'attachment; filename="SdPlayments-0.1.0.jar"'
            } : {}),
            "Cache-Control": isPluginDownload
                ? "private, no-store"
                : pageName === "admin.html" || protectedPages.has(pageName)
                    ? "no-store"
                    : "no-cache"
        });
        response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
        if (error.code === "ENOENT" || error.code === "EISDIR") {
            response.writeHead(404).end("Not found");
            return;
        }
        throw error;
    }
}

async function handleRequest(request, response) {
    try {
        const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
        if (url.pathname.startsWith("/api/")) {
            await handleApi(request, response, url);
            return;
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
            response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
            return;
        }
        await serveStatic(request, response, url);
    } catch (error) {
        if (response.headersSent) {
            response.destroy(error);
            return;
        }
        sendJson(response, error.status || 500, { error: error.status ? error.message : "Внутренняя ошибка сервера." });
        if (!error.status) {
            console.error(error);
        }
    }
}

async function start() {
    const telegramSettingsCount = [telegramToken, telegramChatId].filter(Boolean).length;
    if (telegramSettingsCount !== 0 && telegramSettingsCount !== 2) {
        throw new Error("Set both SDONATE_TELEGRAM_BOT_TOKEN and SDONATE_TELEGRAM_CHAT_ID, or leave both unset.");
    }
    if (telegramToken && !/^\d+:[A-Za-z0-9_-]+$/.test(telegramToken)) {
        throw new Error("SDONATE_TELEGRAM_BOT_TOKEN has an invalid format.");
    }
    if (telegramChatId && !/^-?\d+$/.test(telegramChatId)) {
        throw new Error("SDONATE_TELEGRAM_CHAT_ID must be a numeric private chat ID.");
    }
    await bootstrapAdmin();
    http.createServer(handleRequest).listen(port, host, () => {
        console.log(`SDonate server listening on http://${host}:${port}`);
        if (configuredPublicBaseUrl) {
            console.log(`Public base URL: ${configuredPublicBaseUrl}`);
        } else {
            console.log("PUBLIC_BASE_URL is not set; public links will be built from the request Host header.");
        }
        console.log("Behind an HTTPS reverse proxy, make sure it sends the X-Forwarded-Proto and X-Forwarded-Host headers.");
        if (telegramConfigured) {
            console.log("Telegram verification notifications and private-chat decisions are enabled.");
            void pollTelegramUpdates();
        } else {
            console.warn("Telegram is not configured; verification requests will remain available in the admin panel.");
        }
        if (recaptchaEnabled) {
            console.log("Google reCAPTCHA is enabled for login and registration.");
        } else {
            console.warn("reCAPTCHA is not configured; set RECAPTCHA_SITE_KEY and RECAPTCHA_SECRET_KEY to enable it.");
        }
    });
}

start().catch(error => {
    console.error(`Could not start SDonate server: ${error.message}`);
    process.exitCode = 1;
});
