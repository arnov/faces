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

void boot();
