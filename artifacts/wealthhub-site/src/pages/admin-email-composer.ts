declare const DB: {
  users: Array<{ email: string; kyc: string; status: string }>;
};
declare const esc: (value: unknown) => string;
declare const toast: (message: string) => void;

export const adminEmailStyles = `
  .email-composer {
    margin: 22px 0 30px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 18px;
    background: var(--bg);
    box-shadow: 0 14px 36px rgba(10, 18, 48, 0.06);
  }

  .email-composer__heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 18px;
    padding: 22px 24px 18px;
    border-bottom: 1px solid var(--line);
  }

  .email-composer__heading h2 {
    margin: 3px 0 4px;
    font-size: 21px;
    letter-spacing: -0.025em;
  }

  .email-composer__heading p,
  .email-composer__help {
    margin: 0;
    color: var(--mute);
    font-size: 13px;
  }

  .email-composer__badge {
    flex: none;
    padding: 6px 10px;
    border: 1px solid color-mix(in srgb, var(--brand) 28%, var(--line));
    border-radius: 999px;
    background: color-mix(in srgb, var(--brand) 9%, var(--bg));
    color: var(--brand);
    font-size: 12px;
    font-weight: 700;
  }

  .email-composer__form {
    display: grid;
    gap: 17px;
    padding: 22px 24px 24px;
  }

  .email-composer__fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }

  .email-composer__field {
    display: grid;
    align-content: start;
    gap: 7px;
    min-width: 0;
  }

  .email-composer__field--wide {
    grid-column: 1 / -1;
  }

  .email-composer__field label {
    color: var(--ink);
    font-size: 13px;
    font-weight: 700;
  }

  .email-composer__field .sel {
    width: 100%;
    min-width: 0;
  }

  .email-composer__message {
    min-height: 170px;
    resize: vertical;
    line-height: 1.6;
  }

  .email-composer__upload {
    display: grid;
    gap: 8px;
    padding: 15px;
    border: 1px dashed color-mix(in srgb, var(--brand) 42%, var(--line));
    border-radius: 12px;
    background: color-mix(in srgb, var(--brand) 4%, var(--bg));
  }

  .email-composer__upload input {
    max-width: 100%;
    color: var(--mute);
    font: inherit;
    font-size: 13px;
  }

  .email-attachment-list {
    display: grid;
    gap: 8px;
  }

  .email-attachment {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg);
  }

  .email-attachment__thumb {
    width: 42px;
    height: 42px;
    flex: none;
    border-radius: 7px;
    background: color-mix(in srgb, var(--brand) 9%, var(--bg));
    object-fit: cover;
  }

  .email-attachment__meta {
    display: grid;
    min-width: 0;
    flex: 1;
    gap: 2px;
  }

  .email-attachment__name {
    overflow: hidden;
    font-size: 13px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .email-attachment__size {
    color: var(--mute);
    font-size: 11px;
  }

  .email-attachment__remove {
    flex: none;
    padding: 6px 8px;
    border-radius: 7px;
    color: var(--dn);
    font-size: 12px;
    font-weight: 700;
  }

  .email-attachment__remove:hover {
    background: color-mix(in srgb, var(--dn) 9%, transparent);
  }

  .email-composer__error {
    min-height: 18px;
    color: var(--dn);
    font-size: 12px;
  }

  .email-composer__actions {
    display: flex;
    justify-content: flex-end;
    padding-top: 2px;
  }

  .email-preview-section {
    padding: 20px 24px 26px;
    border-top: 1px solid var(--line);
    background: color-mix(in srgb, var(--brand) 3%, var(--bg));
  }

  .email-preview-section__label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
    color: var(--mute);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .email-preview-card {
    max-width: 760px;
    margin: 0 auto;
    overflow: hidden;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    background: #fff;
    color: #172033;
    box-shadow: 0 12px 30px rgba(10, 18, 48, 0.08);
  }

  .email-preview-card__brand {
    padding: 18px 24px;
    border-bottom: 1px solid #edf0f5;
    color: #205cf2;
    font-size: 13px;
    font-weight: 750;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .email-preview-card__content {
    padding: 22px 24px;
  }

  .email-preview-card__recipient {
    margin: 0 0 7px;
    color: #68738a;
    font-size: 12px;
  }

  .email-preview-card__subject {
    margin: 0 0 18px;
    color: #172033;
    font-size: 21px;
    font-weight: 700;
    line-height: 1.3;
  }

  .email-preview-card__body {
    min-height: 48px;
    color: #344054;
    font-size: 14px;
    line-height: 1.75;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .email-preview-card__attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1px solid #edf0f5;
  }

  .email-preview-card__image {
    width: 112px;
    height: 84px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    object-fit: cover;
  }

  .email-preview-card__file {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    max-width: 100%;
    padding: 7px 10px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    color: #344054;
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .email-preview-card__footer {
    padding: 14px 24px;
    border-top: 1px solid #edf0f5;
    color: #8791a4;
    font-size: 11px;
    line-height: 1.5;
  }

  @media (max-width: 640px) {
    .email-composer__heading,
    .email-composer__form,
    .email-preview-section {
      padding-right: 16px;
      padding-left: 16px;
    }

    .email-composer__fields {
      grid-template-columns: minmax(0, 1fr);
    }

    .email-composer__field--wide {
      grid-column: auto;
    }

    .email-composer__heading {
      flex-direction: column;
    }
  }
`;

function installAdminEmailComposer() {
  const browserWindow = window as typeof window & {
    __adminEmailComposerMarkup?: () => string;
    __adminEmailDraft?: {
      audience: string;
      subject: string;
      body: string;
      attachments: Array<{ file: File; previewUrl: string | null }>;
      error: string;
    };
  };
  const draft = (browserWindow.__adminEmailDraft ??= {
    audience: "all",
    subject: "",
    body: "",
    attachments: [],
    error: "",
  });
  const maxFiles = 8;
  const maxTotalBytes = 20 * 1024 * 1024;
  const byteLabel = (size: number) =>
    size < 1024 * 1024
      ? `${Math.max(1, Math.round(size / 1024))} KB`
      : `${(size / (1024 * 1024)).toFixed(1)} MB`;
  const matchingUsers = () => {
    const users = DB.users.filter((user) => user.status === "active");
    if (draft.audience === "verified") {
      return users.filter((user) => user.kyc === "verified");
    }
    if (draft.audience === "unverified") {
      return users.filter((user) => user.kyc !== "verified");
    }
    return users;
  };
  const audienceLabel = () =>
    draft.audience === "verified"
      ? "Verified users"
      : draft.audience === "unverified"
        ? "Unverified users"
        : "All active users";

  function attachmentsMarkup() {
    if (!draft.attachments.length) {
      return `<p class="email-composer__help">No files attached yet.</p>`;
    }
    return draft.attachments
      .map(({ file, previewUrl }, index) => {
        const thumbnail = previewUrl
          ? `<img class="email-attachment__thumb" src="${previewUrl}" alt="">`
          : `<span class="email-attachment__thumb" aria-hidden="true"></span>`;
        return `<div class="email-attachment">${thumbnail}<span class="email-attachment__meta"><span class="email-attachment__name">${esc(file.name)}</span><span class="email-attachment__size">${byteLabel(file.size)}</span></span><button class="email-attachment__remove" type="button" data-email-remove="${index}" aria-label="Remove ${esc(file.name)}">Remove</button></div>`;
      })
      .join("");
  }

  function previewMarkup() {
    const body = esc(draft.body || "Your email message will appear here.");
    const attachments = draft.attachments
      .map(({ file, previewUrl }) =>
        previewUrl
          ? `<img class="email-preview-card__image" src="${previewUrl}" alt="${esc(file.name)}">`
          : `<span class="email-preview-card__file"><strong>FILE</strong>${esc(file.name)}</span>`,
      )
      .join("");
    return `<article class="email-preview-card"><div class="email-preview-card__brand">Auvrenthia Markets</div><div class="email-preview-card__content"><p class="email-preview-card__recipient">To: ${esc(audienceLabel())} · ${matchingUsers().length} recipients</p><h3 class="email-preview-card__subject">${esc(draft.subject || "Your subject will appear here")}</h3><div class="email-preview-card__body">${body}</div>${attachments ? `<div class="email-preview-card__attachments" aria-label="Email attachments">${attachments}</div>` : ""}</div><div class="email-preview-card__footer">You are receiving this message because you have an account with Auvrenthia Markets.</div></article>`;
  }

  function composerMarkup() {
    const options = [
      ["all", "All active users"],
      ["verified", "Verified users"],
      ["unverified", "Unverified users"],
    ];
    return `<section class="email-composer" aria-labelledby="support-email-heading"><header class="email-composer__heading"><div><div class="lbl">Customer communication</div><h2 id="support-email-heading">Compose an email</h2><p>Write a message and check the email preview before using it.</p></div><span class="email-composer__badge">Preview only</span></header><form class="email-composer__form" id="support-email-form"><div class="email-composer__fields"><div class="email-composer__field"><label for="support-email-audience">Audience</label><select class="sel" id="support-email-audience">${options
      .map(
        ([value, label]) =>
          `<option value="${value}"${draft.audience === value ? " selected" : ""}>${label} (${DB.users.filter((user) => user.status === "active" && (value === "all" || (value === "verified" ? user.kyc === "verified" : user.kyc !== "verified"))).length})</option>`,
      )
      .join("")}</select></div><div class="email-composer__field"><label for="support-email-subject">Subject</label><input class="sel" id="support-email-subject" type="text" maxlength="160" placeholder="Add an email subject" value="${esc(draft.subject)}"></div><div class="email-composer__field email-composer__field--wide"><label for="support-email-body">Message</label><textarea class="sel email-composer__message" id="support-email-body" maxlength="10000" placeholder="Write your message to users">${esc(draft.body)}</textarea></div><div class="email-composer__field email-composer__field--wide"><label for="support-email-files">Attachments</label><div class="email-composer__upload"><input id="support-email-files" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx"><p class="email-composer__help">Add images or common document files. Up to ${maxFiles} files and 20 MB total. Files stay in this browser preview.</p></div><div class="email-attachment-list" id="support-email-attachments">${attachmentsMarkup()}</div><p class="email-composer__error" id="support-email-error" aria-live="polite">${esc(draft.error)}</p></div></div><div class="email-composer__actions"><button class="btn alt" type="button" data-email-clear>Clear draft</button></div></form><section class="email-preview-section" aria-label="Email preview"><div class="email-preview-section__label"><span>Live email preview</span><span id="support-email-count">${matchingUsers().length} recipients</span></div><div id="support-email-preview">${previewMarkup()}</div></section></section>`;
  }

  function refreshPreview() {
    const preview = document.querySelector("#support-email-preview");
    const count = document.querySelector("#support-email-count");
    const fileList = document.querySelector("#support-email-attachments");
    const error = document.querySelector("#support-email-error");
    if (preview) preview.innerHTML = previewMarkup();
    if (count) count.textContent = `${matchingUsers().length} recipients`;
    if (fileList) fileList.innerHTML = attachmentsMarkup();
    if (error) error.textContent = draft.error;
  }

  function clearDraft() {
    for (const attachment of draft.attachments) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    }
    draft.audience = "all";
    draft.subject = "";
    draft.body = "";
    draft.attachments = [];
    draft.error = "";
    const audience = document.querySelector<HTMLSelectElement>(
      "#support-email-audience",
    );
    const subject = document.querySelector<HTMLInputElement>(
      "#support-email-subject",
    );
    const body = document.querySelector<HTMLTextAreaElement>(
      "#support-email-body",
    );
    const files = document.querySelector<HTMLInputElement>(
      "#support-email-files",
    );
    if (audience) audience.value = "all";
    if (subject) subject.value = "";
    if (body) body.value = "";
    if (files) files.value = "";
    refreshPreview();
  }

  browserWindow.__adminEmailComposerMarkup = composerMarkup;

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      return;
    }
    if (target.id === "support-email-subject") {
      draft.subject = target.value;
    } else if (target.id === "support-email-body") {
      draft.body = target.value;
    } else {
      return;
    }
    refreshPreview();
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement || target instanceof HTMLInputElement)) {
      return;
    }
    if (target.id === "support-email-audience") {
      draft.audience = target.value;
      refreshPreview();
      return;
    }
    if (
      target.id !== "support-email-files" ||
      !(target instanceof HTMLInputElement) ||
      !target.files
    ) {
      return;
    }

    let totalBytes = draft.attachments.reduce(
      (total, attachment) => total + attachment.file.size,
      0,
    );
    draft.error = "";
    for (const file of Array.from(target.files)) {
      if (draft.attachments.length >= maxFiles) {
        draft.error = `You can attach up to ${maxFiles} files.`;
        break;
      }
      if (totalBytes + file.size > maxTotalBytes) {
        draft.error = "Attachments cannot exceed 20 MB in total.";
        continue;
      }
      totalBytes += file.size;
      draft.attachments.push({
        file,
        previewUrl: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : null,
      });
    }
    target.value = "";
    refreshPreview();
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const clearButton = target.closest("[data-email-clear]");
    if (clearButton) {
      clearDraft();
      toast("Email draft cleared.");
      return;
    }
    const removeButton = target.closest("[data-email-remove]");
    if (!removeButton) return;
    const index = Number(removeButton.getAttribute("data-email-remove"));
    const [attachment] = draft.attachments.splice(index, 1);
    if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    draft.error = "";
    refreshPreview();
  });

  document.addEventListener("submit", (event) => {
    if ((event.target as Element | null)?.id === "support-email-form") {
      event.preventDefault();
    }
  });
}

export const adminEmailBehavior = `(${installAdminEmailComposer.toString()})();`;
