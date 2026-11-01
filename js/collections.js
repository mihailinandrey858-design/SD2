if (sessionStorage.getItem("sdonate-demo-authenticated") !== "true") {
    window.location.replace("./reg.html?mode=login");
} else {
    (function () {
        var shopId = new URLSearchParams(window.location.search).get("id");
        var $ = function (id) { return document.getElementById(id); };
        var shops, shop;
        var selected = new Set();
        var image = "";

        $("account-name").textContent = sessionStorage.getItem("sdonate-demo-nickname") || "Игрок";
        $("col-back").href = shopId ? "./shop-dashboard.html?id=" + encodeURIComponent(shopId) : "./shops.html";

        try {
            shops = JSON.parse(sessionStorage.getItem(window.sdonateShopStorage.storageKey()) || "[]");
            shop = shops.find(function (s) { return s.id === shopId; });
        } catch (e) { shop = null; }
        if (!shop) { window.location.replace("./shops.html"); return; }

        shop.tools = shop.tools || {};
        shop.tools.collections = Array.isArray(shop.tools.collections) ? shop.tools.collections : [];
        var products = Array.isArray(shop.products) ? shop.products : [];

        function save() { window.sdonateShopStorage.save(shops); }
        function msg(t, ok) { $("col-msg").textContent = t; $("col-msg").className = "col-msg" + (ok ? " ok" : ""); }
        function price(p) { return new Intl.NumberFormat("ru-RU").format(Number(p) || 0) + "₽"; }

        // Серверы из товаров и из настроек магазина
        var serverNames = new Set();
        (Array.isArray(shop.servers) ? shop.servers : []).forEach(function (s) {
            var n = typeof s === "string" ? s : s && s.name;
            if (n) serverNames.add(n);
        });
        products.forEach(function (p) { (p.servers || []).forEach(function (n) { serverNames.add(n); }); });
        serverNames.forEach(function (n) {
            var o = document.createElement("option");
            o.value = o.textContent = n;
            $("col-server").append(o);
        });

        function thumb(src, cls) {
            if (src) { var i = document.createElement("img"); i.src = src; i.alt = ""; return i; }
            var d = document.createElement("span"); d.className = cls || "ph"; return d;
        }

        function renderProducts() {
            var box = $("col-products");
            box.replaceChildren();
            $("col-empty").hidden = products.length > 0;
            products.forEach(function (p) {
                var b = document.createElement("button");
                b.type = "button";
                b.className = "col-product" + (selected.has(p.id) ? " on" : "");
                var t = document.createElement("div");
                var n = document.createElement("b"); n.textContent = p.name;
                var s = document.createElement("small"); s.textContent = price(p.price);
                t.append(n, s);
                b.append(thumb(p.image), t);
                b.onclick = function () {
                    if (selected.has(p.id)) selected.delete(p.id); else selected.add(p.id);
                    b.classList.toggle("on");
                };
                box.append(b);
            });
        }

        function renderList() {
            var list = $("col-list");
            list.replaceChildren();
            $("col-count").textContent = shop.tools.collections.length;
            shop.tools.collections.forEach(function (c, i) {
                var row = document.createElement("article");
                row.className = "col-item";
                var t = document.createElement("div");
                var n = document.createElement("b"); n.textContent = c.name;
                var s = document.createElement("small");
                s.textContent = (c.server || "Все сервера") + " · товаров: " + (c.productIds || []).length;
                t.append(n, s);
                var del = document.createElement("button");
                del.type = "button"; del.textContent = "Удалить";
                del.onclick = function () { shop.tools.collections.splice(i, 1); save(); renderList(); };
                row.append(thumb(c.image), t, del);
                list.append(row);
            });
        }

        $("col-image").addEventListener("change", function (e) {
            var file = e.target.files[0];
            if (!file) return;
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () {
                var k = Math.min(1, 400 / Math.max(img.width, img.height));
                var c = document.createElement("canvas");
                c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
                c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
                image = c.toDataURL("image/jpeg", 0.8);
                URL.revokeObjectURL(url);
                $("col-image-preview").src = image;
                $("col-image-preview").hidden = false;
                $("col-image-ph").style.display = "none";
            };
            img.onerror = function () { msg("Не удалось прочитать изображение.", false); };
            img.src = url;
        });

        $("col-form").addEventListener("submit", function (e) {
            e.preventDefault();
            var name = $("col-name").value.trim();
            if (!name) return msg("Укажи название подборки.", false);
            shop.tools.collections.push({
                id: "c" + Date.now(),
                name: name,
                server: $("col-server").value,
                image: image,
                productIds: Array.from(selected)
            });
            try { save(); } catch (err) { shop.tools.collections.pop(); return msg("Не удалось сохранить (мало места).", false); }
            $("col-form").reset();
            selected.clear(); image = "";
            $("col-image-preview").hidden = true;
            $("col-image-ph").style.display = "";
            renderProducts(); renderList();
            msg("Подборка добавлена.", true);
        });

        $("logout-button").addEventListener("click", function () {
            fetch("/api/auth/logout", { method: "POST" }).catch(function () {}).finally(function () {
                sessionStorage.removeItem("sdonate-demo-authenticated");
                window.location.href = "./reg.html?mode=login";
            });
        });

        renderProducts();
        renderList();
    })();
}
