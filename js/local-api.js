// Локальный режим без сервера: если страница открыта как файл (или сервер недоступен),
// запросы к /api/ обрабатываются прямо в браузере и хранятся в localStorage.
(function () {
    const realFetch = window.fetch.bind(window);
    const ACCOUNTS = "sdonate-local-accounts";
    const SESSION = "sdonate-local-session";
    const VERIFICATIONS = "sdonate-local-verifications";

    const read = (key, fallback) => {
        try {
            return JSON.parse(localStorage.getItem(key)) ?? fallback;
        } catch {
            return fallback;
        }
    };
    const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
    const json = (status, body) => new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" }
    });

    async function hash(password, salt) {
        const text = salt + password;
        if (window.crypto && crypto.subtle) {
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
            return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
        }
        let h = 5381;
        for (const ch of text) {
            h = ((h << 5) + h + ch.codePointAt(0)) >>> 0;
        }
        return "weak-" + h.toString(16);
    }

    const publicUser = user => ({
        id: user.id,
        nickname: user.nickname,
        email: user.email,
        role: "user",
        isAdmin: false
    });

    const currentUser = () => {
        const id = localStorage.getItem(SESSION);
        return read(ACCOUNTS, []).find(user => user.id === id) || null;
    };

    async function handle(path, method, body) {
        if (path === "/api/auth/me" && method === "GET") {
            const user = currentUser();
            return user ? json(200, { user: publicUser(user) }) : json(401, { error: "Нужно войти в аккаунт." });
        }

        if (path === "/api/auth/register" && method === "POST") {
            const nickname = String(body.nickname || "").trim();
            const email = String(body.email || "").trim().toLowerCase();
            const password = String(body.password || "");
            if (!/^[A-Za-z0-9_]{3,16}$/.test(nickname)) {
                return json(400, { error: "Ник должен содержать 3–16 символов: латинские буквы, цифры или _." });
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return json(400, { error: "Укажи корректный адрес электронной почты." });
            }
            if (password.length < 8) {
                return json(400, { error: "Пароль должен содержать не меньше 8 символов." });
            }
            const accounts = read(ACCOUNTS, []);
            if (accounts.some(user => user.email === email)) {
                return json(409, { error: "Аккаунт с такой почтой уже существует." });
            }
            const salt = crypto.randomUUID();
            const user = {
                id: crypto.randomUUID(),
                nickname,
                email,
                salt,
                passwordHash: await hash(password, salt),
                createdAt: new Date().toISOString()
            };
            write(ACCOUNTS, [...accounts, user]);
            localStorage.setItem(SESSION, user.id);
            return json(201, { user: publicUser(user) });
        }

        if (path === "/api/auth/login" && method === "POST") {
            const email = String(body.email || "").trim().toLowerCase();
            const user = read(ACCOUNTS, []).find(candidate => candidate.email === email);
            if (!user || user.passwordHash !== await hash(String(body.password || ""), user.salt)) {
                return json(401, { error: "Неверная почта или пароль." });
            }
            localStorage.setItem(SESSION, user.id);
            return json(200, { user: publicUser(user) });
        }

        if (path === "/api/auth/logout" && method === "POST") {
            localStorage.removeItem(SESSION);
            return json(200, { ok: true });
        }

        if (path === "/api/verification") {
            const user = currentUser();
            if (!user) {
                return json(401, { error: "Нужно войти в аккаунт." });
            }
            const all = read(VERIFICATIONS, []);
            const mine = all.filter(item => item.userId === user.id).pop() || null;
            if (method === "GET") {
                return json(200, { request: mine });
            }
            if (mine && (mine.status === "pending" || mine.status === "approved")) {
                return json(409, { error: "Заявка уже отправлена." });
            }
            if (!body.consent || !body.surname || !body.firstName || !body.phone) {
                return json(400, { error: "Заполни все поля и дай согласие на обработку данных." });
            }
            const record = {
                id: String(all.length + 1),
                userId: user.id,
                status: "pending",
                surname: String(body.surname),
                firstName: String(body.firstName),
                patronymic: String(body.patronymic || ""),
                phone: String(body.phone),
                createdAt: new Date().toISOString()
            };
            write(VERIFICATIONS, [...all, record]);
            return json(200, { request: record, telegramConfigured: false, notificationSent: false });
        }

        // Админ-панель требует настоящего сервера
        return json(403, { error: "Доступно только при запуске через сервер (node server.js)." });
    }

    window.fetch = async function (input, init) {
        const raw = typeof input === "string" ? input : input.url;
        if (!raw.startsWith("/api/")) {
            return realFetch(input, init);
        }
        const apiPath = raw.split("?")[0];
        const method = String((init && init.method) || "GET").toUpperCase();
        let body = {};
        try {
            body = init && init.body ? JSON.parse(init.body) : {};
        } catch {
            body = {};
        }

        if (window.location.protocol === "file:") {
            return handle(apiPath, method, body);
        }
        try {
            return await realFetch(input, init);
        } catch {
            return handle(apiPath, method, body);
        }
    };
})();
