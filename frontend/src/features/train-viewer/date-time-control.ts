import { displayDateTimeLabels } from "../../domain/display-date-time";

export interface DateTimeDisplayElements {
  input: HTMLInputElement;
  date: HTMLElement;
  clock: HTMLTimeElement;
}

export function renderDisplayDateTime(
  elements: DateTimeDisplayElements,
  value: Date,
): void {
  const labels = displayDateTimeLabels(value);
  elements.date.textContent = labels.date;
  const [hour, minute, second] = labels.time.split(":");
  const primaryTime = document.createElement("span");
  primaryTime.textContent = `${hour}:${minute}`;
  const seconds = document.createElement("small");
  seconds.textContent = `:${second}`;
  elements.clock.replaceChildren(primaryTime, seconds);
  elements.clock.dateTime = value.toISOString();
  if (document.activeElement !== elements.input) {
    elements.input.value = formatDateTimeLocal(value);
  }
}

export function formatDateTimeLocal(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

export function maximumRouteTimeFor(
  trains: Array<{ stops: Array<{ route_time_minutes?: number }> }>,
): number {
  let maximumRouteTime = 24 * 60;
  for (const train of trains) {
    for (const stop of train.stops) {
      if (typeof stop.route_time_minutes === "number") {
        maximumRouteTime = Math.max(maximumRouteTime, stop.route_time_minutes);
      }
    }
  }
  return maximumRouteTime;
}

export function configureDateTimeInput(
  input: HTMLInputElement,
  getDate: () => Date,
  setDate: (date: Date) => void,
): void {
  const display = input.closest<HTMLElement>(".date-time-display");
  const control = input.closest<HTMLElement>(".time-control");
  if (!display || !control) {
    throw new Error("表示日時コントロールが見つかりません。");
  }
  const picker = createDateTimePicker();
  control.append(picker.element);
  display.setAttribute("aria-controls", picker.element.id);

  let selectedDate = getDate();
  let visibleMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
  const close = () => {
    picker.element.hidden = true;
    display.ariaExpanded = "false";
  };
  const render = () => {
    picker.month.textContent = `${visibleMonth.getFullYear()}年${visibleMonth.getMonth() + 1}月`;
    picker.days.replaceChildren(...calendarDayButtons(visibleMonth, selectedDate, (date) => {
      selectedDate = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        selectedDate.getHours(),
        selectedDate.getMinutes(),
        selectedDate.getSeconds(),
      );
      render();
    }));
    picker.hour.value = String(selectedDate.getHours()).padStart(2, "0");
    picker.minute.value = String(selectedDate.getMinutes()).padStart(2, "0");
    picker.second.value = String(selectedDate.getSeconds()).padStart(2, "0");
  };
  const open = () => {
    if (input.disabled) return;
    selectedDate = getDate();
    visibleMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    render();
    picker.element.hidden = false;
    display.ariaExpanded = "true";
  };

  input.disabled = false;
  input.value = formatDateTimeLocal(getDate());
  display.addEventListener("click", (event) => {
    event.preventDefault();
    picker.element.hidden ? open() : close();
  });
  display.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    } else if (event.key === "Escape") {
      close();
    }
  });
  picker.previous.addEventListener("click", () => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
    render();
  });
  picker.next.addEventListener("click", () => {
    visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
    render();
  });
  picker.cancel.addEventListener("click", close);
  picker.apply.addEventListener("click", () => {
    selectedDate.setHours(
      boundedNumber(picker.hour.value, 0, 23),
      boundedNumber(picker.minute.value, 0, 59),
      boundedNumber(picker.second.value, 0, 59),
      0,
    );
    setDate(selectedDate);
    close();
  });
  picker.element.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
      display.focus();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!control.contains(event.target as Node)) close();
  });
}

interface DateTimePickerElements {
  element: HTMLElement;
  month: HTMLElement;
  days: HTMLElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  hour: HTMLSelectElement;
  minute: HTMLSelectElement;
  second: HTMLSelectElement;
  cancel: HTMLButtonElement;
  apply: HTMLButtonElement;
}

function createDateTimePicker(): DateTimePickerElements {
  const element = document.createElement("section");
  element.id = "date-time-picker";
  element.className = "date-time-picker";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", "表示日時を選択");
  element.hidden = true;
  const hours = timeSelectOptions(23);
  const minutesAndSeconds = timeSelectOptions(59);
  element.innerHTML = `
    <header>
      <strong class="date-time-picker-month"></strong>
      <span class="date-time-picker-navigation">
        <button type="button" data-picker-action="previous" aria-label="前の月"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 5-5 5 5 5"/></svg></button>
        <button type="button" data-picker-action="next" aria-label="次の月"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 5 5 5-5 5"/></svg></button>
      </span>
    </header>
    <div class="date-time-picker-weekdays" aria-hidden="true"><span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span></div>
    <div class="date-time-picker-days" role="grid"></div>
    <div class="date-time-picker-time" aria-label="時刻">
      <label><select data-picker-time="hour" aria-label="時">${hours}</select></label>
      <b aria-hidden="true">:</b>
      <label><select data-picker-time="minute" aria-label="分">${minutesAndSeconds}</select></label>
      <b aria-hidden="true">:</b>
      <label><select data-picker-time="second" aria-label="秒">${minutesAndSeconds}</select></label>
    </div>
    <footer>
      <button type="button" data-picker-action="cancel" aria-label="閉じる" title="閉じる"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 5.5 9 9m0-9-9 9"/></svg></button>
      <button type="button" data-picker-action="apply" aria-label="この日時に変更" title="この日時に変更"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10.5 3.5 3.5 7.5-8"/></svg></button>
    </footer>`;
  const required = <T extends Element>(selector: string): T => {
    const value = element.querySelector<T>(selector);
    if (!value) throw new Error(`日時ピッカー要素が見つかりません: ${selector}`);
    return value;
  };
  return {
    element,
    month: required(".date-time-picker-month"),
    days: required(".date-time-picker-days"),
    previous: required('[data-picker-action="previous"]'),
    next: required('[data-picker-action="next"]'),
    hour: required('[data-picker-time="hour"]'),
    minute: required('[data-picker-time="minute"]'),
    second: required('[data-picker-time="second"]'),
    cancel: required('[data-picker-action="cancel"]'),
    apply: required('[data-picker-action="apply"]'),
  };
}

function timeSelectOptions(maximum: number): string {
  return Array.from({ length: maximum + 1 }, (_, value) => {
    const label = String(value).padStart(2, "0");
    return `<option value="${label}">${label}</option>`;
  }).join("");
}

function calendarDayButtons(
  month: Date,
  selected: Date,
  select: (date: Date) => void,
): HTMLButtonElement[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "gridcell");
    button.textContent = String(date.getDate());
    button.dataset.outsideMonth = String(date.getMonth() !== month.getMonth());
    button.ariaSelected = String(
      date.getFullYear() === selected.getFullYear() &&
      date.getMonth() === selected.getMonth() &&
      date.getDate() === selected.getDate(),
    );
    button.addEventListener("click", () => select(date));
    return button;
  });
}

function boundedNumber(value: string, minimum: number, maximum: number): number {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, number))
    : minimum;
}
