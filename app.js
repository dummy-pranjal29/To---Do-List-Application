(() => {
  if (!window.CSS || typeof CSS.escape !== "function") {
    window.CSS = window.CSS || {};
    CSS.escape = function (value) {
      return String(value).replace(/[^a-zA-Z0-9_\-]/g, "\\$&");
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function q(id) {
    const el = document.getElementById(id);
    if (!el) console.warn(`Missing element with id="${id}" — check HTML IDs.`);
    return el;
  }

  function init() {
    const STORAGE_KEY = "todos-v1";
    const THEME_KEY = "theme";

    const els = {
      form: q("todo-form"),
      input: q("new-task"),
      addBtn: q("add-task-btn"),
      list: q("task-list"),
      filters: document.querySelector(".filters"),
      clearCompleted: q("clear-completed"),
      itemsLeft: q("items-left"),
      themeToggle: q("theme-toggle"),
      confirmDialog: q("confirm-dialog"),
    };

    if (!els.form || !els.input || !els.addBtn || !els.list) {
      console.error(
        "Critical elements missing; verify HTML structure and IDs."
      );
      return;
    }

    
    let tasks = loadTasks();
    let filter = "all";
    let pendingDeleteId = null;

    
    applySavedTheme();
    render();
    updateItemsLeft();
    syncFilterUI();

    
    els.addBtn?.addEventListener("click", onAdd);
    els.form?.addEventListener("submit", (e) => {
      e.preventDefault();
      onAdd();
    });

    els.input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onAdd();
      }
    });

    els.list?.addEventListener("click", onListClick);
    els.list?.addEventListener("change", onListChange);
    els.list?.addEventListener("keydown", onListKeydown);
    els.list?.addEventListener("focusout", onListFocusOut);

    els.filters?.addEventListener("click", onFilterClick);
    els.clearCompleted?.addEventListener("click", clearCompleted);

    els.themeToggle?.addEventListener("click", toggleTheme);

    if (
      els.confirmDialog &&
      typeof els.confirmDialog.showModal === "function"
    ) {
      els.confirmDialog.addEventListener("close", () => {
        const { returnValue } = els.confirmDialog;
        if (returnValue === "confirm" && pendingDeleteId != null) {
          removeTask(pendingDeleteId);
          pendingDeleteId = null;
        } else {
          pendingDeleteId = null;
        }
      });
    }

    
    function onAdd() {
      const title = els.input.value.trim();
      if (!title) return;
      const now = Date.now();
      const task = {
        id: cryptoRandomId(),
        title,
        completed: false,
        createdAt: now,
        updatedAt: now,
      };
      tasks.unshift(task);
      persist();
      els.input.value = "";
      render();
      updateItemsLeft();
    }

    function onListClick(e) {
      const target = e.target;
      if (target.classList.contains("delete")) {
        const li = target.closest(".task");
        if (!li) return;
        const id = li.dataset.id;
        handleDelete(id);
        return;
      }
      if (target.classList.contains("edit")) {
        const li = target.closest(".task");
        if (!li) return;
        enterEditMode(li);
        return;
      }
    }

    function onListChange(e) {
      const target = e.target;
      if (target.classList.contains("toggle")) {
        const li = target.closest(".task");
        if (!li) return;
        const id = li.dataset.id;
        toggleComplete(id, target.checked);
      }
    }

    function onListKeydown(e) {
      const isEditingField = e.target.classList?.contains("task-title");
      if (isEditingField) {
        if (e.key === "Enter") {
          e.preventDefault();
          commitEdit(e.target);
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelEdit(e.target);
        }
      }
    }

    function onListFocusOut(e) {
      const input = e.target;
      if (
        input.classList?.contains("task-title") &&
        input.classList.contains("editing")
      ) {
        queueMicrotask(() => {
          if (!input.matches(":focus")) {
            commitEdit(input);
          }
        });
      }
    }

    function onFilterClick(e) {
      const btn = e.target.closest(".filter");
      if (!btn) return;
      filter = btn.dataset.filter;
      syncFilterUI();
      render();
    }

    function clearCompleted() {
      const before = tasks.length;
      tasks = tasks.filter((t) => !t.completed);
      if (tasks.length !== before) {
        persist();
        render();
        updateItemsLeft();
      }
    }

    function toggleTheme() {
      const html = document.documentElement;
      const next =
        html.dataset.theme === "light"
          ? "dark"
          : html.dataset.theme === "dark"
          ? "auto"
          : "light";
      if (next === "auto") {
        delete html.dataset.theme;
        localStorage.removeItem(THEME_KEY);
      } else {
        html.dataset.theme = next;
        localStorage.setItem(THEME_KEY, next);
      }
    }

    
    function handleDelete(id) {
      pendingDeleteId = id;
      if (
        els.confirmDialog &&
        typeof els.confirmDialog.showModal === "function"
      ) {
        els.confirmDialog.showModal();
      } else {
        const ok = window.confirm("Delete this task?");
        if (ok) removeTask(id);
        else pendingDeleteId = null;
      }
    }

    function removeTask(id) {
      const idx = tasks.findIndex((t) => t.id === id);
      if (idx >= 0) {
        tasks.splice(idx, 1);
        persist();
        render();
        updateItemsLeft();
      }
    }

    function toggleComplete(id, value) {
      const t = tasks.find((x) => x.id === id);
      if (!t) return;
      t.completed = Boolean(value);
      t.updatedAt = Date.now();
      persist();
      const li = els.list.querySelector(`.task[data-id="${CSS.escape(id)}"]`);
      if (li) {
        li.classList.toggle("completed", t.completed);
        const checkbox = li.querySelector(".toggle");
        if (checkbox) checkbox.checked = t.completed;
      }
      updateItemsLeft();
      if (filter !== "all") render();
    }

    function enterEditMode(li) {
      const input = li.querySelector(".task-title");
      if (!input) return;
      if (!input.readOnly && input.classList.contains("editing")) return;
      input.readOnly = false;
      input.classList.add("editing");
      input.dataset.original = input.value;
      input.focus({ preventScroll: true });
      const val = input.value;
      input.value = "";
      input.value = val;
    }

    function commitEdit(inputEl) {
      const li = inputEl.closest(".task");
      const id = li?.dataset.id;
      if (!id) return;
      const next = inputEl.value.trim();
      inputEl.readOnly = true;
      inputEl.classList.remove("editing");
      if (!next) {
        inputEl.value = inputEl.dataset.original ?? "";
        delete inputEl.dataset.original;
        return;
      }
      const t = tasks.find((x) => x.id === id);
      if (t && t.title !== next) {
        t.title = next;
        t.updatedAt = Date.now();
        persist();
      }
      delete inputEl.dataset.original;
    }

    function cancelEdit(inputEl) {
      inputEl.value = inputEl.dataset.original ?? inputEl.value;
      inputEl.readOnly = true;
      inputEl.classList.remove("editing");
      delete inputEl.dataset.original;
    }

    
    function render() {
      const frag = document.createDocumentFragment();
      const data = getFiltered();
      for (const t of data) frag.appendChild(renderItem(t));
      els.list.replaceChildren(frag);
    }

    function renderItem(t) {
      const li = document.createElement("li");
      li.className = "task";
      li.dataset.id = t.id;
      if (t.completed) li.classList.add("completed");

      const label = document.createElement("label");
      label.className = "checkbox";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "toggle";
      cb.checked = t.completed;
      cb.setAttribute("aria-label", "Toggle complete");

      const checkmark = document.createElement("span");
      checkmark.className = "checkmark";
      checkmark.setAttribute("aria-hidden", "true");

      label.append(cb, checkmark);

      const title = document.createElement("input");
      title.className = "task-title";
      title.value = t.title;
      title.readOnly = true;
      title.setAttribute("aria-label", "Task title");

      const actions = document.createElement("div");
      actions.className = "actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "edit";
      editBtn.textContent = "Edit";
      editBtn.setAttribute("aria-label", "Edit task");

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "delete danger";
      delBtn.textContent = "Delete";
      delBtn.setAttribute("aria-label", "Delete task");

      actions.append(editBtn, delBtn);
      li.append(label, title, actions);
      return li;
    }

    function updateItemsLeft() {
      const remaining = tasks.reduce(
        (acc, t) => acc + (t.completed ? 0 : 1),
        0
      );
      els.itemsLeft.textContent = `${remaining} item${
        remaining === 1 ? "" : "s"
      } left`;
    }

    function syncFilterUI() {
      const btns = document.querySelectorAll(".filter");
      btns.forEach((b) => {
        const active = b.dataset.filter === filter;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-selected", String(active));
      });
    }

    function getFiltered() {
      if (filter === "active") return tasks.filter((t) => !t.completed);
      if (filter === "completed") return tasks.filter((t) => t.completed);
      return tasks;
    }

    
    function loadTasks() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) return [];
        return data
          .filter(
            (t) => t && typeof t.id === "string" && typeof t.title === "string"
          )
          .map((t) => ({
            id: t.id,
            title: t.title,
            completed: Boolean(t.completed),
            createdAt: Number(t.createdAt) || Date.now(),
            updatedAt: Number(t.updatedAt) || Date.now(),
          }));
      } catch {
        return [];
      }
    }

    function persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
      } catch {
        
      }
    }

    function applySavedTheme() {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") {
        document.documentElement.dataset.theme = saved;
      } else {
        delete document.documentElement.dataset.theme;
      }
    }

    
    function cryptoRandomId() {
      if (crypto?.randomUUID) return crypto.randomUUID();
      return (
        "id-" +
        Math.random().toString(36).slice(2, 11) +
        Date.now().toString(36)
      );
    }
  }
})();

