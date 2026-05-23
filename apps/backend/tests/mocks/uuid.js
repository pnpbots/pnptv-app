'use strict';

const { randomUUID } = require('crypto');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-([1-5])[0-9a-f]{3}-([89ab])[0-9a-f]{3}-[0-9a-f]{12}$/i;

const v4 = () => randomUUID();

const validate = (value) => UUID_RE.test(String(value || ''));

const version = (value) => {
  const match = String(value || '').match(UUID_RE);
  return match ? Number(match[1]) : null;
};

module.exports = {
  v4,
  validate,
  version,
};
