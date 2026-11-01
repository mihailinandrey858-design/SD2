// Кнопка "Вакансии" в магазине: игрок выбирает роль, заполняет форму, заявка уходит в Telegram-бот.
(function () {
    var params = new URLSearchParams(window.location.search);
    var vacancies = [];
    try {
        var stored = JSON.parse(sessionStorage.getItem("sdonate-demo-shops:account:" + encodeURIComponent(params.get("owner"))) || "[]");
        var current = stored.find(function (s) { return s && s.id === params.get("id"); });
        vacancies = (current && current.tools && current.tools.vacancies) || [];
    } catch (e) { vacancies = []; }
    if (!vacancies.length) return;

    var ROLES = vacancies.map(function (v) { return v.role; }).filter(function (r, i, a) { return a.indexOf(r) === i; });
    var infoByRole = {};
    var questionsByRole = {};
    vacancies.forEach(function (v) { infoByRole[v.role] = v.text; questionsByRole[v.role] = v.questions || []; });

    var css = document.createElement("style");
    css.textContent =
        ".vac-btn{cursor:pointer;font:inherit;font-weight:700;color:#111;border:0;border-radius:999px;padding:9px 16px;background:linear-gradient(135deg,#f2f3f7,#9da1ad)}" +
        ".vac-section{max-width:1100px;margin:60px auto 40px;padding:0 16px;font-family:'DM Sans',Arial,sans-serif;color:#e8eaf0}" +
        ".vac-section h2{margin:0 0 6px;font-size:26px}.vac-section>p{margin:0 0 20px;color:#9aa0ae}" +
        ".vac-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}" +
        ".vac-card{display:flex;flex-direction:column;gap:8px;text-align:left;cursor:pointer;font:inherit;color:#e8eaf0;padding:20px;border-radius:18px;background:linear-gradient(160deg,#20222c,#14151b);border:1px solid rgba(255,255,255,.12);transition:transform .2s,border-color .2s,box-shadow .2s}" +
        ".vac-card:hover{transform:translateY(-4px);border-color:#c9ccd6;box-shadow:0 14px 30px rgba(0,0,0,.45)}" +
        ".vac-card b{font-size:18px}.vac-card span{color:#9aa0ae;font-size:13px;line-height:1.45;flex:1}.vac-card i{font-style:normal;font-weight:700;font-size:13px;color:#c9ccd6}" +
        ".vac-back{position:fixed;inset:0;z-index:9999;background:rgba(5,6,10,.72);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;padding:16px}" +
        ".vac-back.open{display:flex}.vac-back.open .vac-box{animation:vacIn .28s ease}" +
        "@keyframes vacIn{from{opacity:0;transform:translateY(18px) scale(.97)}to{opacity:1;transform:none}}" +
        ".vac-box{position:relative;width:100%;max-width:500px;max-height:92vh;overflow:auto;padding:0 28px 28px;border-radius:22px;background:linear-gradient(180deg,#1b1d26,#12131a);color:#e8eaf0;border:1px solid rgba(255,255,255,.14);box-shadow:0 30px 80px rgba(0,0,0,.6);font-family:'DM Sans',Arial,sans-serif;scrollbar-width:thin;scrollbar-color:#3a3d4a transparent}" +
        ".vac-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:12px;margin:0 -28px 16px;padding:20px 28px 14px;background:#1b1d26;border-bottom:1px solid rgba(255,255,255,.08)}" +
        ".vac-head img{width:38px;height:38px}.vac-head h2{margin:0;font-size:20px}.vac-head small{color:#8d92a1}" +
        ".vac-box p{margin:0 0 14px;color:#9aa0ae;font-size:14px;line-height:1.5}" +
        ".vac-box label{display:block;margin:16px 0 6px;font-size:13px;font-weight:700;color:#d5d8e2}" +
        ".vac-box input,.vac-box select,.vac-box textarea{width:100%;box-sizing:border-box;padding:12px 14px;font:inherit;font-size:14px;color:#fff;background:#0e0f14;border:1px solid rgba(255,255,255,.12);border-radius:12px;transition:border-color .15s,box-shadow .15s}" +
        ".vac-box input:focus,.vac-box textarea:focus{outline:none;border-color:#c9ccd6;box-shadow:0 0 0 3px rgba(201,204,214,.15)}" +
        ".vac-box textarea{min-height:70px;resize:vertical}" +
        ".vac-roles{display:flex;flex-wrap:wrap;gap:8px}" +
        ".vac-roles button{cursor:pointer;font:inherit;font-size:13px;color:#e8eaf0;padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.04);transition:all .15s}" +
        ".vac-roles button:hover{border-color:#fff}.vac-roles button.on{background:linear-gradient(135deg,#f2f3f7,#a7abb7);color:#111;font-weight:700;border-color:transparent}" +
        ".vac-info{margin:12px 0 0!important;padding:12px 14px;border-radius:12px;background:rgba(255,255,255,.05);border-left:3px solid #c9ccd6;color:#c3c7d2!important}" +
        ".vac-send{width:100%;margin-top:22px;padding:14px;border:0;border-radius:12px;cursor:pointer;font:inherit;font-size:15px;font-weight:800;color:#111;background:linear-gradient(135deg,#f2f3f7,#9da1ad);transition:transform .15s,box-shadow .15s}" +
        ".vac-send:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(200,204,216,.25)}" +
        ".vac-close{position:absolute;top:16px;right:18px;z-index:3;width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.08);border:0;color:#cfd2dc;font-size:20px;cursor:pointer}" +
        ".vac-close:hover{background:rgba(255,255,255,.18)}" +
        ".vac-msg{margin-top:12px;padding:10px 12px;border-radius:10px;font-size:14px;display:none}" +
        ".vac-msg.ok{display:block;background:rgba(60,180,110,.15);color:#8be0aa}" +
        ".vac-msg.err{display:block;background:rgba(220,70,70,.15);color:#ff9a9a}";
    document.head.appendChild(css);

    var back = document.createElement("div");
    back.className = "vac-back";
    back.innerHTML =
        '<form class="vac-box" novalidate>' +
        '<button type="button" class="vac-close" aria-label="Закрыть">×</button>' +
        '<div class="vac-head"><img src="./img/Серебристый куб с эмблемой SD.png" alt=""><div><h2>Форма заявки</h2><small>Анкета на собеседование</small></div></div>' +
        "<p>Заполни анкету. Мы пришлём приглашение на собеседование в Telegram.</p>" +
        '<div class="vac-roles" style="display:none"></div><p class="vac-info"></p>' +
        '<label>Игровой ник</label><input name="nick" maxlength="16" placeholder="Steve_123">' +
        '<label>Telegram для связи</label><input name="contact" maxlength="40" placeholder="@username">' +
        '<div class="vac-qs"></div>' +
        '<button class="vac-send" type="submit">Отправить заявку</button>' +
        '<div class="vac-msg" role="status"></div>' +
        "</form>";
    document.body.appendChild(back);

    var form = back.querySelector("form");
    var rolesBox = back.querySelector(".vac-roles");
    var msg = back.querySelector(".vac-msg");
    var role = ROLES[0];
    var info = back.querySelector(".vac-info");
    var qsBox = back.querySelector(".vac-qs");

    // Вопросы анкеты выбранной роли; без вопросов — одно поле "О себе"
    function renderQuestions() {
        qsBox.replaceChildren();
        var qs = questionsByRole[role] && questionsByRole[role].length ? questionsByRole[role] : ["О себе (опыт, онлайн, ссылка на канал)"];
        qs.forEach(function (q) {
            var l = document.createElement("label");
            l.textContent = q;
            var t = document.createElement("textarea");
            t.maxLength = 500;
            t.style.minHeight = "64px";
            t.dataset.q = q;
            qsBox.append(l, t);
        });
    }
    info.textContent = infoByRole[role] || "";
    renderQuestions();

    ROLES.forEach(function (r, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = r;
        if (i === 0) b.className = "on";
        b.onclick = function () {
            role = r;
            info.textContent = infoByRole[r] || "";
            renderQuestions();
            [].forEach.call(rolesBox.children, function (x) { x.className = ""; });
            b.className = "on";
        };
        rolesBox.appendChild(b);
    });

    function show(t, ok) { msg.textContent = t; msg.className = "vac-msg " + (ok ? "ok" : "err"); }
    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function close() { back.classList.remove("open"); }

    back.querySelector(".vac-close").onclick = close;
    back.addEventListener("click", function (e) { if (e.target === back) close(); });

    form.addEventListener("submit", function (e) {
        e.preventDefault();
        var f = form.elements;
        var d = { nick: f.nick.value.trim(), contact: f.contact.value.trim() };
        var answers = [].map.call(qsBox.querySelectorAll("textarea"), function (t) { return { q: t.dataset.q, a: t.value.trim() }; });
        if (!/^[A-Za-z0-9_]{3,16}$/.test(d.nick)) return show("Ник: 3–16 символов, латиница, цифры, _", false);
        if (!d.contact || answers.some(function (x) { return !x.a; })) return show("Заполни все поля анкеты.", false);

        // Заявки хранятся в localStorage, чтобы владелец увидел их в панели
        var all;
        try { all = JSON.parse(localStorage.getItem("sdonate-applications") || "[]"); } catch (err) { all = []; }
        if (!Array.isArray(all)) all = [];
        all.push({ id: "a" + Date.now(), shopId: params.get("id"), role: role, nick: d.nick, contact: d.contact, answers: answers, at: Date.now() });
        try { localStorage.setItem("sdonate-applications", JSON.stringify(all)); } catch (err) { return show("Не удалось отправить заявку.", false); }

        // Отправка на сервер (база + письмо владельцу), если endpoint задан в applications-config.js
        var endpoint = (window.SDONATE_APPLICATIONS || {}).endpoint;
        if (endpoint) {
            var shopNameEl = document.getElementById("store-brand-name");
            var item = all[all.length - 1];
            fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    shopId: item.shopId,
                    ownerId: params.get("owner"),
                    shopName: shopNameEl ? shopNameEl.textContent : "",
                    role: item.role,
                    nick: item.nick,
                    contact: item.contact,
                    answers: item.answers,
                    at: item.at
                })
            }).catch(function () {});
        }
        form.reset();
        show("Заявка отправлена! Владелец увидит её на сайте и свяжется с тобой.", true);
    });

    var nav = document.querySelector(".store-nav");
    var host = document.querySelector("main") || document.body;

    // Блок табличек внизу витрины: по одной на каждую роль
    var sec = document.createElement("section");
    sec.id = "vac-section";
    sec.className = "vac-section";
    sec.innerHTML = '<h2>Нужны люди в команду</h2><p>Выбери роль и заполни анкету — мы свяжемся с тобой в Telegram.</p><div class="vac-cards"></div>';
    var cards = sec.querySelector(".vac-cards");
    ROLES.forEach(function (r) {
        var c = document.createElement("button");
        c.type = "button";
        c.className = "vac-card";
        var h = document.createElement("b");
        h.textContent = "Нужен " + r;
        var s = document.createElement("span");
        s.textContent = infoByRole[r] || "";
        var go = document.createElement("i");
        go.textContent = "Заполнить анкету →";
        c.append(h, s, go);
        c.onclick = function () { openForm(r); };
        cards.append(c);
    });
    host.appendChild(sec);

    // Проверка статуса заявки по нику
    var chk = document.createElement("div");
    chk.style.cssText = "margin-top:24px;display:flex;gap:10px;flex-wrap:wrap;align-items:center";
    chk.innerHTML = '<input class="vac-chk-nick" maxlength="16" placeholder="Твой ник" style="padding:11px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:#0e0f14;color:#fff;font:inherit">' +
        '<button type="button" class="vac-chk-btn vac-card" style="padding:11px 18px;flex-direction:row">Проверить статус заявки</button><span class="vac-chk-res"></span>';
    sec.appendChild(chk);
    chk.querySelector(".vac-chk-btn").onclick = function () {
        var nick = chk.querySelector(".vac-chk-nick").value.trim().toLowerCase();
        var res = chk.querySelector(".vac-chk-res");
        var list;
        try { list = JSON.parse(localStorage.getItem("sdonate-applications") || "[]"); } catch (e) { list = []; }
        var mine = list.filter(function (a) { return a.shopId === params.get("id") && String(a.nick).toLowerCase() === nick; });
        if (!nick || !mine.length) { res.textContent = "Заявок с таким ником не найдено."; return; }
        res.textContent = mine.map(function (a) {
            var s = a.status === "accepted" ? "✅ принят" : a.status === "rejected" ? "❌ отклонён" : "⏳ на рассмотрении";
            return a.role + ": " + s;
        }).join(" · ");
    };

    function openForm(r) {
        role = r;
        info.textContent = infoByRole[r] || "";
        form.querySelector("h2").textContent = "Нужен " + r;
        renderQuestions();
        msg.className = "vac-msg";
        back.classList.add("open");
    }

    if (nav) {
        var open = document.createElement("a");
        open.href = "#vac-section";
        open.textContent = "Форма";
        nav.appendChild(open);
    }
})();
