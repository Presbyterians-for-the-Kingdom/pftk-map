// Applies a saved light/dark choice before the page paints, so it doesn't
// flash. The sun/moon button on the map (app.js) saves it; with nothing
// saved, the device setting decides (see styles.css).
try {
  const theme = localStorage.getItem('pftk-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch (e) {
  // Storage blocked: follow the device.
}
