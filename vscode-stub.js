class Disposable {
  constructor(fn) { this._fn = fn; }
  dispose() { if (this._fn) this._fn(); }
}
module.exports = {
  Disposable,
  workspace: { getConfiguration: () => ({ get: () => "zh" }) },
};
