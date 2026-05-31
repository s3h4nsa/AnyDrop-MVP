export function setText(element, value) {
  if (element) element.textContent = value;
}

export function toggleClass(element, className, enabled) {
  if (element) element.classList.toggle(className, Boolean(enabled));
}
