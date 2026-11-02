const form = document.querySelector("#auth-form");
const nicknameInput = document.querySelector("#nickname");
const nicknameField = document.querySelector("#nickname-field");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const confirmInput = document.querySelector("#confirm-password");
const confirmField = document.querySelector("#confirm-field");
const termsRow = document.querySelector("#terms-row");
const termsInput = document.querySelector("#terms");
const title = document.querySelector("#auth-title");
const subtitle = document.querySelector("#auth-subtitle");
const submitButton = document.querySelector("#submit-button");
const modeToggle = document.querySelector("#mode-toggle");
const switchLabel = document.querySelector("#switch-label");
const passwordHint = document.querySelector("#password-hint");
const forgotLink = document.querySelector("#forgot-link");
const message = document.querySelector("#form-message");
const showPasswordButton = document.querySelector(".show-password");
const captchaField = document.querySelector("#captcha-field");

let currentMode = "register";
let recaptchaWidgetId = null;
let recaptchaEnabled = false;

function getRecaptchaToken() {
    if (!recaptchaEnabled || recaptchaWidgetId === null || !window.grecaptcha) {
        return "";
    }
    return grecaptcha.getResponse(recaptchaWidgetId);
}

function resetRecaptcha() {
    if (recaptchaEnabled && recaptchaWidgetId !== null && window.grecaptcha) {
        grecaptcha.reset(recaptchaWidgetId);
    }
}

function renderRecaptcha(siteKey) {
    if (recaptchaWidgetId !== null || !window.grecaptcha || !grecaptcha.render) {
        return;
    }
    recaptchaWidgetId = grecaptcha.render("recaptcha-widget", { sitekey: siteKey, theme: "dark" });
    captchaField.hidden = false;
}

function loadRecaptchaScript(siteKey) {
    window.onRecaptchaLoad = () => renderRecaptcha(siteKey);
    const script = document.createElement("script");
    script.src = "https://www.google.com/recaptcha/api.js?onload=onRecaptchaLoad&render=explicit";
    script.async = true;
    script.defer = true;
    script.onerror = () => showMessage("Не удалось загрузить reCAPTCHA. Проверь подключение к интернету.", "error");
    document.head.appendChild(script);
}

async function initCaptcha() {
    try {
        const response = await fetch("/api/auth/captcha-config", { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) {
            return;
        }
        const config = await response.json();
        if (!config.enabled || !config.siteKey) {
            return;
        }
        recaptchaEnabled = true;
        if (window.grecaptcha && grecaptcha.render) {
            renderRecaptcha(config.siteKey);
        } else {
            loadRecaptchaScript(config.siteKey);
        }
    } catch {
        // reCAPTCHA недоступна (например, локальный режим без сервера) — форма работает без неё
    }
}

function showMessage(text, type = "info") {
    message.textContent = text;
    message.classList.toggle("error", type === "error");
    message.hidden = false;
}

function clearMessage() {
    message.textContent = "";
    message.classList.remove("error");
    message.hidden = true;
}

function setMode(mode, updateUrl = true) {
    currentMode = mode === "login" ? "login" : "register";
    const isLogin = currentMode === "login";

    title.textContent = isLogin ? "С возвращением" : "Создай аккаунт";
    subtitle.textContent = isLogin
        ? "Войди, чтобы управлять магазином сервера"
        : "Начни собирать свой магазин для сервера";
    submitButton.firstElementChild.textContent = isLogin ? "Войти" : "Создать аккаунт";
    switchLabel.textContent = isLogin ? "Ещё нет аккаунта?" : "Уже есть аккаунт?";
    modeToggle.textContent = isLogin ? "Создать аккаунт" : "Войти";
    modeToggle.href = isLogin ? "?mode=register" : "?mode=login";

    nicknameField.hidden = isLogin;
    nicknameInput.required = !isLogin;
    confirmField.hidden = isLogin;
    confirmInput.required = !isLogin;
    termsRow.hidden = isLogin;
    termsInput.required = !isLogin;
    passwordHint.hidden = isLogin;
    passwordInput.minLength = isLogin ? 1 : 8;
    passwordInput.autocomplete = isLogin ? "current-password" : "new-password";
    forgotLink.hidden = !isLogin;
    clearMessage();
    confirmInput.setCustomValidity("");
    form.reset();
    resetRecaptcha();

    if (updateUrl) {
        const url = new URL(window.location.href);
        url.searchParams.set("mode", currentMode);
        window.history.replaceState(null, "", url);
    }
}

function updatePasswordMatch() {
    if (currentMode === "register" && confirmInput.value && confirmInput.value !== passwordInput.value) {
        confirmInput.setCustomValidity("Пароли не совпадают.");
    } else {
        confirmInput.setCustomValidity("");
    }
}

modeToggle.addEventListener("click", event => {
    event.preventDefault();
    setMode(currentMode === "login" ? "register" : "login");
});

showPasswordButton.addEventListener("click", () => {
    const visible = passwordInput.type === "password";
    passwordInput.type = visible ? "text" : "password";
    showPasswordButton.textContent = visible ? "Скрыть" : "Показать";
    showPasswordButton.setAttribute("aria-label", visible ? "Скрыть пароль" : "Показать пароль");
    showPasswordButton.setAttribute("aria-pressed", String(visible));
});

passwordInput.addEventListener("input", updatePasswordMatch);
confirmInput.addEventListener("input", updatePasswordMatch);

forgotLink.addEventListener("click", event => {
    event.preventDefault();
    window.location.assign("./reset-password.html");
});

form.addEventListener("submit", async event => {
    event.preventDefault();
    updatePasswordMatch();

    if (!form.reportValidity()) {
        return;
    }

    const recaptchaToken = getRecaptchaToken();
    if (recaptchaEnabled && !recaptchaToken) {
        showMessage("Подтверди, что ты не робот.", "error");
        return;
    }

    const submitLabel = submitButton.firstElementChild;
    const originalLabel = submitLabel.textContent;
    submitButton.disabled = true;
    submitLabel.textContent = currentMode === "login" ? "Входим..." : "Создаём аккаунт...";

    try {
        const response = await fetch(currentMode === "login" ? "/api/auth/login" : "/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(currentMode === "login"
                ? {
                    email: emailInput.value.trim(),
                    password: passwordInput.value,
                    recaptchaToken
                }
                : {
                    nickname: nicknameInput.value.trim(),
                    email: emailInput.value.trim(),
                    password: passwordInput.value,
                    recaptchaToken
                })
        });
        const result = await response.json();
        if (!response.ok) {
            showMessage(result.error || "Не удалось выполнить запрос.", "error");
            if (result.captchaFailed) {
                resetRecaptcha();
            }
            return;
        }

        sessionStorage.setItem("sdonate-demo-nickname", result.user.nickname);
        sessionStorage.setItem("sdonate-demo-email", result.user.email);
        sessionStorage.setItem("sdonate-demo-user-id", result.user.id);
        sessionStorage.setItem("sdonate-demo-authenticated", "true");
        window.location.assign("./dashboard.html");
    } catch (error) {
        console.error("Не удалось выполнить запрос авторизации:", error);
        showMessage("Не удалось выполнить запрос. Попробуй ещё раз.", "error");
    } finally {
        submitButton.disabled = false;
        submitLabel.textContent = originalLabel;
    }
});

const initialMode = new URLSearchParams(window.location.search).get("mode");
setMode(initialMode, false);
initCaptcha();
