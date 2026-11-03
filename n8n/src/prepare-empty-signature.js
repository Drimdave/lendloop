// A GET has no body, so the signature covers `${t}.` with an empty body.
const t = Math.floor(Date.now() / 1000);
return [{ json: { t, message: `${t}.` } }];
