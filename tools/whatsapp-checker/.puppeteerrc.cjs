// Never download a browser when installing: the tool uses Chrome or Edge already on the PC
// (and downloads Chrome itself, with checks, only if neither can start).
module.exports = { skipDownload: true };
