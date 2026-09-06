/**
 * CalendarKit - Application Constants & Configuration
 * 
 * Central place to manage URLs and app configurations.
 */
const APP_CONFIG = {
  FEEDBACK_FORM_URL: 'https://forms.gle/VXd1gVj6s9FiVdhh8',
  KOFI_URL: 'https://ko-fi.com/psarveshkr',
  GCAL_DEFAULT_URL: 'https://calendar.google.com',
  GCAL_SETTINGS_URL: 'https://calendar.google.com/calendar/r/settings'
};

if (typeof window !== 'undefined') {
  window.APP_CONFIG = APP_CONFIG;
}
