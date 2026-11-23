// Prints {"2": "2026-11-19", ...}: the cycle-14 Daf Yomi date of each daf of Arakhin,
// using the app's own schedule.
import { dateForDaf, isoDate, findTractate } from '../../src/schedule.js';

const tractate = findTractate('Arakhin');
const dates = {};
for (let daf = tractate.start; daf <= tractate.end; daf++) {
  dates[daf] = isoDate(dateForDaf(tractate, daf, 14));
}
console.log(JSON.stringify(dates));
