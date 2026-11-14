// The one way a YAML-written character card is parsed, shared by the build,
// check-card and export-card. JSON schema: only JSON-representable values
// (an unquoted date stays text, `<<` is an ordinary key), so a card that
// builds is exactly the card that exports.
const yaml = require('js-yaml');

function parseCardYaml(text) {
  return yaml.load(text, {schema: yaml.JSON_SCHEMA});
}

module.exports = {parseCardYaml};
