/* The grade / bunk filter chips used on the Ring up and Campers screens.

   Two rows of tappable buttons: pick a grade, and that grade's bunks appear
   underneath. "All" on either row clears that level. Both screens share this
   file so the chips look and behave the same in both places.

   A filter is just a small object:  { grade: '5', bunk: 'Aspen' }
   Either value can be '' to mean "all". */

import { getGrades, getBunksForGrade } from './store.js';
import { escapeHtml } from './ui.js';

export function emptyFilter() {
  return { grade: '', bunk: '' };
}

// Does this camper pass the filter?
export function matchesFilter(camper, filter) {
  if (filter.grade && camper.grade !== filter.grade) return false;
  if (filter.bunk && camper.bunk !== filter.bunk) return false;
  return true;
}

// The HTML for the chip rows. Drop it into a screen's template.
export function filterHtml(campId, filter) {
  const grades = getGrades(campId);
  const bunks = filter.grade ? getBunksForGrade(campId, filter.grade) : [];

  const chip = (attr, value, label, isActive) =>
    `<button type="button" class="chip ${isActive ? 'is-active' : ''}"
             data-${attr}="${escapeHtml(value)}">${escapeHtml(label)}</button>`;

  return `
    <div class="filter-bar">
      <div class="chip-row">
        <span class="chip-label">Grade</span>
        ${chip('grade', '', 'All', !filter.grade)}
        ${grades.map((g) => chip('grade', g, g, filter.grade === g)).join('')}
      </div>
      ${
        filter.grade
          ? `<div class="chip-row">
               <span class="chip-label">Bunk</span>
               ${chip('bunk', '', 'All', !filter.bunk)}
               ${bunks.map((b) => chip('bunk', b, b, filter.bunk === b)).join('')}
             </div>`
          : ''
      }
    </div>
  `;
}

/* Hooks up the chips after the HTML is on the page. `onChange` is called
   with the new filter whenever a chip is tapped; the screen then re-draws. */
export function wireFilter(root, filter, onChange) {
  root.querySelectorAll('[data-grade]').forEach((button) => {
    button.addEventListener('click', () => {
      // Changing grade always clears the bunk, since bunks belong to a grade.
      onChange({ grade: button.dataset.grade, bunk: '' });
    });
  });

  root.querySelectorAll('[data-bunk]').forEach((button) => {
    button.addEventListener('click', () => {
      onChange({ grade: filter.grade, bunk: button.dataset.bunk });
    });
  });
}
