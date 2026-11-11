// Installed before website scripts in every frame. File selection and uploads
// belong in the system browser in v1, including programmatic showPicker calls.
(() => {
  const stop = Event.prototype.stopImmediatePropagation;
  const prevent = Event.prototype.preventDefault;
  const inputType = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "type").get;
  const notify = () => window.chrome?.webview?.postMessage("knot:uploads-unavailable");
  window.addEventListener("click", event => {
    if (event.composedPath().some(node => node instanceof HTMLInputElement && inputType.call(node) === "file")) {
      prevent.call(event); stop.call(event); notify();
    }
  }, true);
  window.addEventListener("drop", event => {
    if (event.dataTransfer?.files?.length) { prevent.call(event); stop.call(event); notify(); }
  }, true);
  const picker = HTMLInputElement.prototype.showPicker;
  if (picker) Object.defineProperty(HTMLInputElement.prototype, "showPicker", {
    configurable: false, writable: false,
    value: function () {
      if (inputType.call(this) === "file") {
        notify(); throw new DOMException("Open this site in your default browser to upload files.", "NotAllowedError");
      }
      return picker.call(this);
    },
  });
})();
