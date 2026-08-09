/** Tiny element builder — enough structure without pulling in a framework. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === undefined) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

/** A labelled on/off row for the settings sheet. */
export function toggleRow(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', class: 'toggle-input' }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'sheet-row' }, [h('span', { text: label }), input]);
}

/** A labelled select row. */
export function selectRow(
  label: string,
  options: { value: string; label: string }[],
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const select = h('select', { class: 'sheet-select' }) as HTMLSelectElement;
  for (const option of options) {
    const node = h('option', { value: option.value, text: option.label }) as HTMLOptionElement;
    select.appendChild(node);
  }
  select.value = value;
  select.addEventListener('change', () => onChange(select.value));
  return h('label', { class: 'sheet-row' }, [h('span', { text: label }), select]);
}

/** A row of mutually exclusive choices, e.g. tab size. */
export function segmentRow(
  label: string,
  options: { value: string; label: string }[],
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const group = h('div', { class: 'segment' });
  const update = (next: string) => {
    for (const child of Array.from(group.children)) {
      child.classList.toggle('is-active', (child as HTMLElement).dataset.value === next);
    }
  };
  for (const option of options) {
    const button = h('button', { type: 'button', class: 'segment-item', 'data-value': option.value, text: option.label });
    button.addEventListener('click', () => {
      update(option.value);
      onChange(option.value);
    });
    group.appendChild(button);
  }
  update(value);
  return h('div', { class: 'sheet-row' }, [h('span', { text: label }), group]);
}
