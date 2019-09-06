import {formatDistance} from 'date-fns';

/**
   * Formats an int date into a displayable date
   * @param {Number} intDate - date in seconds
   * @returns {String} prettyfied date
   */
export function formatDate(intDate) {
  const padZeros = 13 - intDate.toString().length;
  if (padZeros > 0) {
    intDate *= Math.pow(10, padZeros);
  }
  return formatDistance(new Date(intDate), new Date()) + ' ago';
}

export function normalizeUrl(url) {
  if (!url.endsWith("/")) {
    url += "/";
  }
  return url;
}
