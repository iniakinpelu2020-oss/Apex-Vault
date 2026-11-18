export const $ = (id) => document.getElementById(id);

export function el(tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) node.setAttribute(k, v);
    }
  }
  for (const child of children || []) if (child) node.append(child);
  return node;
}

export function setView(name) {
  for (const view of ["auth", "lock", "vault"]) $(`view-${view}`).hidden = view !== name;
  $("btn-lock").hidden = name !== "vault";
}

let toastTimer = null;
export function toast(message, ms = 2200) {
  const box = $("toast");
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    box.hidden = true;
  }, ms);
}

export function showError(id, message) {
  const node = $(id);
  node.textContent = message || "";
  node.hidden = !message;
}

export function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function setStatus(text) {
  $("vault-status").textContent = text || "";
}

export function renderEntries(items, handlers) {
  const list = $("entry-list");
  list.textContent = "";
  $("empty").hidden = items.length > 0;
  if (!items.length) return;

  for (const item of items) {
    const initials = (item.label || item.serviceId || "?").slice(0, 2);
    const sub = item.error
      ? "cannot decrypt with this password"
      : item.data
        ? item.data.username || item.data.url || "no username"
        : "locked";

    const actions = el("div", { class: "entry-actions" }, [
      el("button", {
        class: "ghost icon",
        type: "button",
        title: "Copy username",
        "aria-label": `Copy username for ${item.label}`,
        onclick: () => handlers.copy(item, "username"),
        text: "👤",
      }),
      el("button", {
        class: "ghost icon",
        type: "button",
        title: "Copy password",
        "aria-label": `Copy password for ${item.label}`,
        onclick: () => handlers.copy(item, "password"),
        text: "🔑",
      }),
      el("button", {
        class: "ghost icon",
        type: "button",
        title: "Edit",
        "aria-label": `Edit ${item.label}`,
        onclick: () => handlers.edit(item),
        text: "✎",
      }),
      el("button", {
        class: "ghost icon",
        type: "button",
        title: "Delete",
        "aria-label": `Delete ${item.label}`,
        onclick: () => handlers.remove(item),
        text: "✕",
      }),
    ]);

    const row = el(
      "li",
      { class: "entry" },
      [
        el("div", { class: "avatar", "aria-hidden": "true", text: initials }),
        el("div", { class: "entry-main" }, [
          el("div", {
            class: "entry-label",
            text: item.label || item.serviceId,
            title: item.label || item.serviceId,
          }),
          el("div", { class: "entry-sub", text: sub, title: sub }),
        ]),
        actions,
      ],
    );
    list.append(row);
  }
}
