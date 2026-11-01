if (sessionStorage.getItem("sdonate-demo-authenticated") !== "true") {
    window.location.replace("./reg.html?mode=login");
} else {
    (function () {
        var shopId = new URLSearchParams(window.location.search).get("id");
        var $ = function (id) { return document.getElementById(id); };
        var shops, shop;

        $("account-name").textContent = sessionStorage.getItem("sdonate-demo-nickname") || "Игрок";
        $("col-back").href = shopId ? "./shop-dashboard.html?id=" + encodeURIComponent(shopId) : "./shops.html";

        try {
            shops = JSON.parse(sessionStorage.getItem(window.sdonateShopStorage.storageKey()) || "[]");
            shop = shops.find(function (s) { return s.id === shopId; });
        } catch (e) { shop = null; }
        if (!shop) { window.location.replace("./shops.html"); return; }

        shop.tools = shop.tools || {};
        shop.tools.vacancies = Array.isArray(shop.tools.vacancies) ? shop.tools.vacancies : [];

        function save() { window.sdonateShopStorage.save(shops); }
        function msg(t, ok) { $("col-msg").textContent = t; $("col-msg").className = "col-msg" + (ok ? " ok" : ""); }

        (Array.isArray(shop.servers) ? shop.servers : []).forEach(function (s) {
            var n = typeof s === "string" ? s : s && s.name;
            if (!n) return;
            var o = document.createElement("option");
            o.value = o.textContent = n;
            $("vac-server").append(o);
        });

        function addQuestion(value) {
            var row = document.createElement("div");
            row.className = "vac-q-row";
            var input = document.createElement("input");
            input.className = "col-input";
            input.maxLength = 120;
            input.placeholder = "Например: Сколько тебе лет?";
            input.value = value || "";
            var del = document.createElement("button");
            del.type = "button"; del.textContent = "×"; del.setAttribute("aria-label", "Удалить вопрос");
            del.onclick = function () { row.remove(); };
            row.append(input, del);
            $("vac-questions").append(row);
        }
        $("vac-add-q").onclick = function () { addQuestion(""); };
        ["Сколько тебе лет?", "Сколько времени можешь быть онлайн в день?", "Был ли опыт на такой должности?"].forEach(addQuestion);

        function renderList() {
            var list = $("col-list");
            list.replaceChildren();
            $("col-count").textContent = shop.tools.vacancies.length;
            shop.tools.vacancies.forEach(function (v, i) {
                var row = document.createElement("article");
                row.className = "col-item";
                var t = document.createElement("div");
                var n = document.createElement("b"); n.textContent = v.role;
                var s = document.createElement("small");
                s.textContent = (v.server || "Все сервера") + " · вопросов: " + (v.questions || []).length;
                t.append(n, s);
                var del = document.createElement("button");
                del.type = "button"; del.textContent = "Удалить";
                del.onclick = function () { shop.tools.vacancies.splice(i, 1); save(); renderList(); };
                row.append(t, del);
                list.append(row);
            });
        }

        $("vac-form").addEventListener("submit", function (e) {
            e.preventDefault();
            var text = $("vac-text").value.trim();
            if (text.length < 10) return msg("Опиши требования (от 10 символов).", false);
            shop.tools.vacancies.push({
                id: "v" + Date.now(),
                role: $("vac-role").value,
                server: $("vac-server").value,
                text: text,
                questions: Array.from($("vac-questions").querySelectorAll("input"))
                    .map(function (i) { return i.value.trim(); })
                    .filter(Boolean)
            });
            save();
            $("vac-text").value = "";
            renderList();
            msg("Форма добавлена и появится в витрине.", true);
        });

        function readApps() {
            try {
                var a = JSON.parse(localStorage.getItem("sdonate-applications") || "[]");
                return Array.isArray(a) ? a : [];
            } catch (e) { return []; }
        }

        function renderApps() {
            var mine = readApps().filter(function (a) { return a.shopId === shopId; }).reverse();
            var box = $("app-list");
            box.replaceChildren();
            $("app-count").textContent = mine.length;
            $("app-empty").hidden = mine.length > 0;
            mine.forEach(function (a) {
                var card = document.createElement("article");
                card.className = "app-card";
                var top = document.createElement("div");
                top.className = "app-top";
                var role = document.createElement("span"); role.className = "app-role"; role.textContent = a.role;
                var nick = document.createElement("b"); nick.textContent = a.nick;
                var contact = document.createElement("span"); contact.textContent = a.contact;
                var when = document.createElement("small"); when.textContent = new Date(a.at).toLocaleString("ru-RU");
                var st = document.createElement("span");
                var status = a.status || "new";
                st.className = "app-status " + status;
                st.textContent = status === "accepted" ? "Принят" : status === "rejected" ? "Отклонён" : "Ожидает";
                top.append(role, nick, contact, st, when);
                card.append(top);
                (a.answers || []).forEach(function (x) {
                    var qa = document.createElement("div");
                    qa.className = "app-qa";
                    qa.textContent = x.q;
                    var p = document.createElement("p"); p.textContent = x.a;
                    qa.append(p);
                    card.append(qa);
                });
                var actions = document.createElement("div");
                actions.className = "app-actions";
                [["accepted", "Принять", "ok"], ["rejected", "Отклонить", "no"]].forEach(function (s) {
                    var b = document.createElement("button");
                    b.type = "button"; b.textContent = s[1]; b.className = "app-btn " + s[2];
                    b.onclick = function () {
                        var list = readApps();
                        var it = list.find(function (x) { return x.id === a.id; });
                        if (it) { it.status = s[0]; localStorage.setItem("sdonate-applications", JSON.stringify(list)); }
                        renderApps();
                    };
                    actions.append(b);
                });
                var del = document.createElement("button");
                del.type = "button"; del.textContent = "Удалить заявку";
                del.onclick = function () {
                    var rest = readApps().filter(function (x) { return x.id !== a.id; });
                    localStorage.setItem("sdonate-applications", JSON.stringify(rest));
                    renderApps();
                };
                actions.append(del);
                card.append(actions);
                box.append(card);
            });
        }
        window.addEventListener("storage", renderApps);

        $("logout-button").addEventListener("click", function () {
            fetch("/api/auth/logout", { method: "POST" }).catch(function () {}).finally(function () {
                sessionStorage.removeItem("sdonate-demo-authenticated");
                window.location.href = "./reg.html?mode=login";
            });
        });

        renderList();
        renderApps();
    })();
}
