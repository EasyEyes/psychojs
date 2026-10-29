import { configureEasyEyes, getEasyEyesContext } from "./EasyEyesContext.js";

test("host context keeps live calibration state and resolves the current reader lazily", () => {
  const calibrationTime = { current: "first" };
  let reader;
  const host = { calibrationTime, getParamReader: () => reader };
  configureEasyEyes(host);
  expect(getEasyEyesContext()).toBe(host);
  expect(getEasyEyesContext().getParamReader()).toBeUndefined();
  calibrationTime.current = "calibrated";
  reader = { session: 2 };
  expect(getEasyEyesContext().calibrationTime.current).toBe("calibrated");
  expect(getEasyEyesContext().getParamReader()).toBe(reader);
});
