// EasyEyes provides its session state after loading the library. Keeping the
// host boundary explicit lets standalone builds avoid bundling the whole app.
let context;

export function configureEasyEyes(host) {
  context = host;
}

export function getEasyEyesContext() {
  if (!context) throw new Error("Configure the EasyEyes host context before using its extensions.");
  return context;
}
