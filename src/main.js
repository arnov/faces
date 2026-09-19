function setupInfo() {
  const toggle = document.querySelector("#info-toggle");
  const panel = document.querySelector("#info");
  if (!toggle || !panel) {
    return;
  }

  function isOpen() {
    return !panel.hidden;
  }

  function open() {
    document.body.classList.add("is-info");
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
  }

  function close() {
    document.body.classList.remove("is-info");
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  }

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    if (isOpen()) {
      close();
    } else {
      open();
    }
  });

  panel.addEventListener("click", (event) => {
    if (event.target === panel) {
      close();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      close();
    }
  });
}

async function boot() {
  const canvas = document.querySelector("#map");
  const label = document.querySelector("#label");
  if (!canvas || !label) {
    return;
  }

  const countries = joinCountries(FACES_WORLD, FACES_COUNTRIES, [
    FACES_TUVALU,
    FACES_KOSOVO,
  ]);
  const assignPortraits = createMap(canvas, label, countries, {});
  const portraits = await loadPortraits(FACES_COUNTRIES);
  assignPortraits(portraits);
}

setupInfo();
void boot();
