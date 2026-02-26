/**
 * Input validation utilities
 */

/**
 * Validate username
 */
function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return { valid: false, error: 'Username is required' };
  }

  if (username.length < 3 || username.length > 30) {
    return { valid: false, error: 'Username must be between 3 and 30 characters' };
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return { valid: false, error: 'Username can only contain letters, numbers, and underscores' };
  }

  return { valid: true };
}

/**
 * Validate bio
 */
function validateBio(bio) {
  if (!bio || typeof bio !== 'string') {
    return { valid: false, error: 'Bio is required' };
  }

  if (bio.length > 500) {
    return { valid: false, error: 'Bio must be 500 characters or less' };
  }

  return { valid: true };
}

/**
 * Validate age
 */
function validateAge(age) {
  const ageNum = parseInt(age);

  if (isNaN(ageNum)) {
    return { valid: false, error: 'Age must be a number' };
  }

  if (ageNum < 18) {
    return { valid: false, error: 'You must be 18 or older to use this service' };
  }

  if (ageNum > 120) {
    return { valid: false, error: 'Please enter a valid age' };
  }

  return { valid: true, value: ageNum };
}

/**
 * Validate coordinates
 */
function validateCoordinates(lat, lng) {
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);

  if (isNaN(latitude) || isNaN(longitude)) {
    return { valid: false, error: 'Invalid coordinates' };
  }

  if (latitude < -90 || latitude > 90) {
    return { valid: false, error: 'Latitude must be between -90 and 90' };
  }

  if (longitude < -180 || longitude > 180) {
    return { valid: false, error: 'Longitude must be between -180 and 180' };
  }

  return { valid: true, value: { lat: latitude, lng: longitude } };
}

/**
 * Sanitize text input to prevent XSS
 */
function sanitizeText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Remove HTML tags
  let sanitized = text.replace(/<[^>]*>/g, '');

  // Escape special characters
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

  return sanitized.trim();
}

/**
 * Validate URL
 */
function validateUrl(url) {
  try {
    new URL(url);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'Invalid URL' };
  }
}

/**
 * Validate email
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }

  return { valid: true };
}

/**
 * Validate phone number (basic)
 */
function validatePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, error: 'Phone number is required' };
  }

  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  if (!phoneRegex.test(phone.replace(/[\s-]/g, ''))) {
    return { valid: false, error: 'Invalid phone number format' };
  }

  return { valid: true };
}

/**
 * Validate message length
 */
function validateMessageLength(message, maxLength = 4096) {
  if (!message || typeof message !== 'string') {
    return { valid: false, error: 'Message is required' };
  }

  if (message.length > maxLength) {
    return { valid: false, error: `Message must be ${maxLength} characters or less` };
  }

  return { valid: true };
}

/**
 * Check if string contains profanity (basic)
 */
function containsProfanity(text) {
  // Basic profanity filter - expand as needed
  const profanityList = ['badword1', 'badword2']; // Add actual words
  const lowerText = text.toLowerCase();

  for (const word of profanityList) {
    if (lowerText.includes(word)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  validateUsername,
  validateBio,
  validateAge,
  validateCoordinates,
  sanitizeText,
  validateUrl,
  validateEmail,
  validatePhone,
  validateMessageLength,
  containsProfanity,
};
