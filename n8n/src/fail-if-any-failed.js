// The write-backs above recorded each failure in Convex. Fail the run as well so
// the error workflow fires and the failure is visible in n8n too.
const failed = $('Prepare write-back').all().filter((i) => i.json.failed).length;
if (failed > 0) {
  throw new Error(`${failed} reminder email(s) could not be sent; see Automation issues in the admin tab`);
}
return [{ json: { reminded: $('Prepare write-back').all().length } }];
