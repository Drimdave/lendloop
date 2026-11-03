// Reads the raw request body (the signature covers the exact bytes) and splits
// the `t=<unix>,v1=<hex>` header. The HMAC itself is computed by the next node.
const item = $input.first();
const raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8');
const header = String(item.json.headers?.['x-lendloop-signature'] ?? '');
const parts = Object.fromEntries(
  header.split(',').map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  }),
);
return [
  {
    json: {
      raw,
      header,
      t: parts.t ?? '',
      v1: parts.v1 ?? '',
      message: `${parts.t}.${raw}`,
      secretConfigured: Boolean($env.N8N_WEBHOOK_SECRET),
    },
  },
];
