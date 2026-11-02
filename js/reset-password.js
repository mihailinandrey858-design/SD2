const requestForm = document.querySelector('#reset-request-form');
const confirmForm = document.querySelector('#reset-confirm-form');
const requestSubmit = document.querySelector('#request-submit');
const confirmSubmit = document.querySelector('#confirm-submit');
const emailInput = document.querySelector('#reset-email');
const newPasswordInput = document.querySelector('#new-password');
const newPasswordConfirmInput = document.querySelector('#new-password-confirm');
const message = document.querySelector('#form-message');
const title = document.querySelector('#auth-title');
const subtitle = document.querySelector('#auth-subtitle');

const params = new URLSearchParams(window.location.search);
const token = params.get('token');

function showMessage(text, type = 'info') {
    message.textContent = text;
    message.classList.toggle('error', type === 'error');
    message.hidden = false;
}

function clearMessage() {
    message.textContent = '';
    message.classList.remove('error');
    message.hidden = true;
}

function setMode(isConfirm) {
    requestForm.hidden = isConfirm;
    confirmForm.hidden = !isConfirm;
    title.textContent = isConfirm ? 'Новый пароль' : 'Восстановление';
    subtitle.textContent = isConfirm ? 'установите пароль для входа' : 'пароля';
}

function validatePasswords() {
    if (newPasswordInput.value && newPasswordConfirmInput.value && newPasswordInput.value !== newPasswordConfirmInput.value) {
        newPasswordConfirmInput.setCustomValidity('Пароли не совпадают.');
        return false;
    }
    newPasswordConfirmInput.setCustomValidity('');
    return true;
}

newPasswordInput.addEventListener('input', validatePasswords);
newPasswordConfirmInput.addEventListener('input', validatePasswords);

requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage();
    if (!requestForm.reportValidity()) {
        return;
    }

    const originalText = requestSubmit.firstElementChild.textContent;
    requestSubmit.disabled = true;
    requestSubmit.firstElementChild.textContent = 'Отправляем...';

    try {
        const response = await fetch('/api/auth/request-password-reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ email: emailInput.value.trim() })
        });
        const result = await response.json();
        if (!response.ok) {
            showMessage(result.error || 'Не удалось отправить ссылку.', 'error');
            return;
        }
        showMessage(result.message || 'Письмо отправлено.');
    } catch (error) {
        console.error(error);
        showMessage('Не удалось выполнить запрос. Попробуйте позже.', 'error');
    } finally {
        requestSubmit.disabled = false;
        requestSubmit.firstElementChild.textContent = originalText;
    }
});

confirmForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage();
    if (!validatePasswords() || !confirmForm.reportValidity()) {
        return;
    }

    const originalText = confirmSubmit.firstElementChild.textContent;
    confirmSubmit.disabled = true;
    confirmSubmit.firstElementChild.textContent = 'Сохраняем...';

    try {
        const response = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
                token,
                password: newPasswordInput.value
            })
        });
        const result = await response.json();
        if (!response.ok) {
            showMessage(result.error || 'Не удалось сменить пароль.', 'error');
            return;
        }
        showMessage('Пароль успешно обновлён. Теперь можно войти в аккаунт.');
        setTimeout(() => {
            window.location.assign('./?mode=login');
        }, 1400);
    } catch (error) {
        console.error(error);
        showMessage('Не удалось сохранить новый пароль.', 'error');
    } finally {
        confirmSubmit.disabled = false;
        confirmSubmit.firstElementChild.textContent = originalText;
    }
});

if (token) {
    setMode(true);
    showMessage('Укажите новый пароль для завершения сброса.');
} else {
    setMode(false);
}
