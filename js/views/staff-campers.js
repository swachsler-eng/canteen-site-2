/* "Campers" — staff manage who is at camp and adjust balances by hand. */

import {
  getCampersByCamp,
  getCamperById,
  getGrades,
  getBunksForGrade,
  getFamilies,
  addCamper,
  deleteCamper,
  adjustBalanceByStaff,
  resetBalanceToZero,
} from '../store.js';
import { money, escapeHtml, toast, openModal, confirmAction, emptyState, parseAmount } from '../ui.js';
import { emptyFilter, matchesFilter, filterHtml, wireFilter } from '../grade-bunk-filter.js';

let search = '';
let filter = emptyFilter();

export function render(root, session) {
  const campId = session.campId;

  function draw() {
    const query = search.trim().toLowerCase();
    const campers = getCampersByCamp(campId)
      .filter((camper) => matchesFilter(camper, filter))
      .filter((camper) =>
        `${camper.firstName} ${camper.lastName} ${camper.familyCode}`.toLowerCase().includes(query)
      );

    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1>Campers</h1>
          <p>Add campers, adjust balances, and look up family codes.</p>
        </div>

        <div class="card">
          ${filterHtml(campId, filter)}

          <div class="filters">
            <input class="input" id="camper-search" type="search"
                   placeholder="Search name or family code"
                   value="${escapeHtml(search)}" autocomplete="off" />
            <button class="btn btn-primary" id="add-camper">Add camper</button>
          </div>

          ${
            campers.length === 0
              ? emptyState(
                  query || filter.grade ? 'No campers match' : 'No campers yet',
                  query || filter.grade ? '' : 'Add your first camper to get started.'
                )
              : `
            <table class="table">
              <thead>
                <tr>
                  <th>Camper</th>
                  <th>Grade / bunk</th>
                  <th>Family code</th>
                  <th class="align-right">Balance</th>
                  <th class="align-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${campers
                  .map(
                    (camper) => `
                      <tr>
                        <td><strong>${escapeHtml(camper.firstName)} ${escapeHtml(camper.lastName)}</strong></td>
                        <td class="muted">
                          Grade ${escapeHtml(camper.grade)} · ${escapeHtml(camper.bunk)}
                        </td>
                        <td><span class="code-badge">${escapeHtml(camper.familyCode)}</span></td>
                        <td class="align-right"><span class="money">${money(camper.balance)}</span></td>
                        <td class="align-right" style="white-space:nowrap">
                          <button class="btn btn-ghost btn-sm" data-adjust="${camper.id}">Balance</button>
                          <button class="btn btn-danger btn-sm" data-delete="${camper.id}">Remove</button>
                        </td>
                      </tr>
                    `
                  )
                  .join('')}
              </tbody>
            </table>
          `
          }
        </div>
      </div>
    `;

    wireFilter(root, filter, (next) => {
      filter = next;
      draw();
    });

    const searchBox = root.querySelector('#camper-search');
    searchBox.addEventListener('input', () => {
      search = searchBox.value;
      draw();
      const fresh = root.querySelector('#camper-search');
      fresh.focus();
      fresh.setSelectionRange(fresh.value.length, fresh.value.length);
    });

    root.querySelector('#add-camper').addEventListener('click', openAddCamperDialog);

    root.querySelectorAll('[data-adjust]').forEach((button) => {
      button.addEventListener('click', () => openBalanceDialog(button.dataset.adjust));
    });

    root.querySelectorAll('[data-delete]').forEach((button) => {
      button.addEventListener('click', () => removeCamper(button.dataset.delete));
    });
  }

  /* ---------- adding a camper ---------- */

  function openAddCamperDialog() {
    const grades = getGrades(campId);

    if (grades.length === 0) {
      toast('This camp has no grades set up yet.', { error: true });
      return;
    }

    const families = getFamilies(campId);

    const { box, close } = openModal(`
      <h2 class="modal-title">Add camper</h2>
      <form id="add-form" novalidate>
        <div class="form-row">
          <label class="field">
            <span class="field-label">First name</span>
            <input class="input" name="firstName" required autocomplete="off" />
          </label>
          <label class="field">
            <span class="field-label">Last name</span>
            <input class="input" name="lastName" required autocomplete="off" />
          </label>
        </div>

        <div class="form-row">
          <label class="field">
            <span class="field-label">Grade</span>
            <select class="select" name="grade" id="grade-select">
              ${grades.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span class="field-label">Bunk</span>
            <!-- Filled in by the grade dropdown below, so a bunk can only ever
                 be one that really exists in the chosen grade. -->
            <select class="select" name="bunk" id="bunk-select"></select>
          </label>
        </div>

        <div class="field">
          <span class="field-label">Family</span>
          <!-- Rebuilt every time the last name changes — see refreshFamilies(). -->
          <div class="family-choices" id="family-choices"></div>
          <span class="muted">Siblings share one code. New families get one generated
            automatically — it is never typed in.</span>
        </div>

        <p class="form-error hidden" id="add-error"></p>

        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="cancel-add">Cancel</button>
          <button type="submit" class="btn btn-primary">Add camper</button>
        </div>
      </form>
    `);

    const gradeSelect = box.querySelector('#grade-select');
    const bunkSelect = box.querySelector('#bunk-select');

    // Whenever the grade changes, rebuild the bunk list for that grade.
    function refreshBunks() {
      bunkSelect.innerHTML = getBunksForGrade(campId, gradeSelect.value)
        .map((bunk) => `<option value="${escapeHtml(bunk)}">${escapeHtml(bunk)}</option>`)
        .join('');
    }
    gradeSelect.addEventListener('change', refreshBunks);
    refreshBunks();

    /* Siblings share one family code, and staff are nearly always adding a
       sibling. So rather than a separate search box, the Family section
       reacts to the Last name field: as soon as a name is typed, any existing
       families with that surname appear as choices, each showing who is
       already in it so two unrelated families with the same surname can be
       told apart.

       "Start a new family" is always listed first and always selected by
       default. Nothing links unless staff deliberately pick a family. */
    const lastNameInput = box.querySelector('[name="lastName"]');
    const familyChoices = box.querySelector('#family-choices');

    function refreshFamilies() {
      const typed = lastNameInput.value.trim().toLowerCase();

      const matches = typed
        ? families.filter((family) =>
            family.campers.some((c) => c.lastName.toLowerCase().startsWith(typed))
          )
        : [];

      // Remember what was picked so re-drawing the list doesn't lose it.
      const previous = box.querySelector('[name="familyChoice"]:checked')?.value || 'new';
      const stillValid = previous === 'new' || matches.some((f) => f.familyCode === previous);
      const selected = stillValid ? previous : 'new';

      const choice = (value, label, detail) => `
        <label class="family-choice">
          <input type="radio" name="familyChoice" value="${escapeHtml(value)}"
                 ${value === selected ? 'checked' : ''} />
          <span>
            <strong>${escapeHtml(label)}</strong>
            ${detail ? `<br /><span class="muted">${escapeHtml(detail)}</span>` : ''}
          </span>
        </label>
      `;

      familyChoices.innerHTML =
        choice('new', 'Start a new family', 'A fresh code will be generated') +
        matches
          .map((family) =>
            choice(
              family.familyCode,
              `Link to ${family.campers.map((c) => c.firstName).join(' & ')} ${family.campers[0].lastName}`,
              `Family code ${family.familyCode}`
            )
          )
          .join('');
    }
    lastNameInput.addEventListener('input', refreshFamilies);
    refreshFamilies();

    box.querySelector('#cancel-add').addEventListener('click', close);

    box.querySelector('#add-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      const firstName = String(data.get('firstName')).trim();
      const lastName = String(data.get('lastName')).trim();
      const errorLine = box.querySelector('#add-error');

      if (!firstName || !lastName) {
        errorLine.textContent = 'Both names are required.';
        errorLine.classList.remove('hidden');
        return;
      }

      const familyChoice = String(data.get('familyChoice'));
      const camper = await addCamper({
        firstName,
        lastName,
        grade: String(data.get('grade')),
        bunk: String(data.get('bunk')),
        familyCode: familyChoice === 'new' ? null : familyChoice,
      });

      close();
      toast(`${camper.firstName} added — family code ${camper.familyCode}.`);
      draw();
    });
  }

  /* ---------- adjusting a balance ---------- */

  function openBalanceDialog(camperId) {
    const camper = getCamperById(camperId);

    const { box, close } = openModal(`
      <h2 class="modal-title">${escapeHtml(camper.firstName)} ${escapeHtml(camper.lastName)}</h2>
      <p class="muted">Current balance <span class="money">${money(camper.balance)}</span></p>

      <form id="balance-form" novalidate style="margin-top:var(--space-4)">
        <label class="field">
          <span class="field-label">What are you doing?</span>
          <select class="select" name="direction">
            <option value="add">Add funds</option>
            <option value="remove">Remove funds</option>
          </select>
        </label>

        <label class="field">
          <span class="field-label">Amount</span>
          <input class="input" name="amount" type="number" step="0.01" min="0.01"
                 placeholder="0.00" autocomplete="off" />
        </label>

        <label class="field">
          <span class="field-label">Reason (optional)</span>
          <input class="input" name="note" type="text" autocomplete="off"
                 placeholder="e.g. cash received at office" />
        </label>

        <p class="form-error hidden" id="balance-error"></p>

        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="reset-zero">Reset to $0.00</button>
          <button type="button" class="btn btn-ghost" id="cancel-balance">Cancel</button>
          <button type="submit" class="btn btn-primary">Apply</button>
        </div>
      </form>
    `);

    const errorLine = box.querySelector('#balance-error');
    box.querySelector('#cancel-balance').addEventListener('click', close);

    box.querySelector('#reset-zero').addEventListener('click', async () => {
      close();
      const confirmed = await confirmAction({
        title: `Reset ${camper.firstName}'s balance to $0.00?`,
        body: `<p class="muted">This removes ${money(camper.balance)} and is recorded in history.</p>`,
        confirmLabel: 'Reset to zero',
        danger: true,
      });
      if (!confirmed) return;
      await resetBalanceToZero(camperId);
      toast(`${camper.firstName}'s balance reset to $0.00.`);
      draw();
    });

    box.querySelector('#balance-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      const amount = parseAmount(data.get('amount'));

      if (amount === null) {
        errorLine.textContent = 'Enter an amount greater than zero.';
        errorLine.classList.remove('hidden');
        return;
      }

      // Removing more than the camper has lands on $0.00 rather than going
      // negative — the store enforces that floor.
      const delta = data.get('direction') === 'remove' ? -amount : amount;
      const updated = await adjustBalanceByStaff(camperId, delta, String(data.get('note') || '').trim());

      close();
      toast(`${camper.firstName}'s balance is now ${money(updated.balance)}.`);
      draw();
    });
  }

  /* ---------- removing a camper ---------- */

  async function removeCamper(camperId) {
    const camper = getCamperById(camperId);
    const confirmed = await confirmAction({
      title: `Remove ${escapeHtml(camper.firstName)} ${escapeHtml(camper.lastName)}?`,
      body: `<p class="muted">They come off the camper lists, but their past
             transactions stay in the camp's history so your records stay complete.</p>`,
      confirmLabel: 'Remove camper',
      danger: true,
    });
    if (!confirmed) return;

    await deleteCamper(camperId);
    toast(`${camper.firstName} removed.`);
    draw();
  }

  draw();
}
