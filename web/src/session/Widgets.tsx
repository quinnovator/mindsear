// Answer widgets for the pending action on the latest tutor turn.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { LearnerAction, Widget } from '../../../shared/api.ts';
import { inline } from '../format.tsx';

type Answer = Extract<LearnerAction, { type: 'answer' }>;
export type AnswerPayload = Pick<Answer, 'response' | 'confidence'>;

export interface WidgetProps {
  widget: Exclude<Widget, { kind: 'none' }>;
  disabled: boolean;
  onAnswer: (a: AnswerPayload) => void;
  onUnsure: () => void;
  /** id of the element holding the question text (for free-text labelling) */
  promptId?: string;
  /** placement uses "Next question" for every submit */
  submitLabel?: string;
  /** placement puts "I'm not sure" on the left of the footer */
  placement?: boolean;
  autoFocus?: boolean;
}

export function AnswerWidget(props: WidgetProps) {
  switch (props.widget.kind) {
    case 'numeric':
      return <NumericWidget {...props} widget={props.widget} />;
    case 'mcq':
      return <McqWidget {...props} widget={props.widget} />;
    case 'free_text':
      return <FreeTextWidget {...props} widget={props.widget} />;
    case 'steps':
      return <StepsWidget {...props} widget={props.widget} />;
    case 'continue':
      return (
        <div className="widget-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={props.disabled}
            autoFocus={props.autoFocus}
            onClick={() => props.onAnswer({ response: { kind: 'continue' } })}
          >
            {props.widget.label}
          </button>
        </div>
      );
  }
}

const NUMBER_RE = /^\s*[-+]?(\d[\d,]*(\.\d*)?|\.\d+)\s*%?\s*$/;
const FRACTION_RE = /^\s*[-+]?\d+\s*\/\s*\d+\s*$/;

export function looksNumeric(s: string): boolean {
  return NUMBER_RE.test(s) || FRACTION_RE.test(s);
}

function UnitInput({
  id,
  value,
  onChange,
  unit,
  placeholder,
  disabled,
  autoFocus,
  invalid,
  describedBy,
  label,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  unit: '%' | '';
  placeholder?: string;
  disabled: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  describedBy?: string;
  label?: string;
}) {
  return (
    <div className={`unit-input${invalid ? ' invalid' : ''}${disabled ? ' disabled' : ''}`}>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
      {unit ? <span aria-hidden="true">{unit}</span> : null}
      {unit === '%' ? <span className="sr-only">percent</span> : null}
    </div>
  );
}

function NumericWidget({
  widget,
  disabled,
  onAnswer,
  submitLabel,
  autoFocus,
}: WidgetProps & { widget: Extract<Widget, { kind: 'numeric' }> }) {
  const [value, setValue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  const errId = `${id}-err`;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const v = value.trim();
    if (!v) return setErr('Enter your answer first.');
    if (!looksNumeric(v)) return setErr('Enter a number like 8.3, or a fraction like 1/12.');
    setErr(null);
    onAnswer({ response: { kind: 'numeric', value: v.replace(/%\s*$/, '').trim() } });
  }
  return (
    <form className="numeric-form" onSubmit={submit} noValidate>
      <div className="numeric-field">
        <label htmlFor={id} className="field-label">
          Your answer
        </label>
        <div className="numeric-row">
          <UnitInput
            id={id}
            value={value}
            onChange={(v) => {
              setValue(v);
              if (err) setErr(null);
            }}
            unit={widget.unit}
            placeholder={widget.placeholder || 'e.g. 12.5'}
            disabled={disabled}
            autoFocus={autoFocus}
            invalid={!!err}
            describedBy={err ? errId : undefined}
          />
          <button type="submit" className="btn btn-primary btn-submit" disabled={disabled}>
            {submitLabel ?? (
              <>
                <span className="desk-only">Submit answer</span>
                <span className="mob-only">Submit</span>
              </>
            )}
          </button>
        </div>
      </div>
      {err ? (
        <p id={errId} className="field-error" role="alert">
          {err}
        </p>
      ) : null}
    </form>
  );
}

function McqWidget({
  widget,
  disabled,
  onAnswer,
  onUnsure,
  submitLabel,
  placement,
  autoFocus,
}: WidgetProps & { widget: Extract<Widget, { kind: 'mcq' }> }) {
  const [sel, setSel] = useState<number | null>(null);
  const name = useId();
  function submit(e: FormEvent) {
    e.preventDefault();
    if (disabled || sel == null) return;
    onAnswer({ response: { kind: 'mcq', index: sel } });
  }
  const unsure =
    widget.allow_unsure || placement ? (
      <button type="button" className="btn btn-secondary" disabled={disabled} onClick={onUnsure}>
        I'm not sure
      </button>
    ) : null;
  return (
    <form className="stack-16" onSubmit={submit}>
      <fieldset className="plain-fieldset mcq-options">
        <legend className="sr-only">Choose one answer</legend>
        {widget.options.map((opt, i) => (
          <label key={i} className={`mcq-option${sel === i ? ' checked' : ''}${disabled ? ' disabled' : ''}`}>
            <input
              type="radio"
              name={name}
              className="radio"
              checked={sel === i}
              disabled={disabled}
              autoFocus={autoFocus && i === 0}
              onChange={() => setSel(i)}
            />
            <span>{inline(opt)}</span>
          </label>
        ))}
      </fieldset>
      <div className={placement ? 'card-footer' : 'widget-row'}>
        {placement ? unsure : null}
        {placement ? <div className="grow" /> : null}
        <button type="submit" className="btn btn-primary" disabled={disabled || sel == null}>
          {submitLabel ?? 'Submit answer'}
        </button>
        {placement ? null : unsure}
      </div>
    </form>
  );
}

const CONF_WORDS = ['guessing', 'unsure', 'somewhat sure', 'pretty sure', 'certain'];
export function confidenceText(n: number): string {
  return `Confidence: ${CONF_WORDS[n - 1] ?? ''} (${n} of 5)`;
}

function FreeTextWidget({
  widget,
  disabled,
  onAnswer,
  onUnsure,
  promptId,
  submitLabel,
  autoFocus,
}: WidgetProps & { widget: Extract<Widget, { kind: 'free_text' }> }) {
  const [text, setText] = useState('');
  const [conf, setConf] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const id = useId();
  const counterId = `${id}-count`;
  const max = widget.max_chars > 0 ? widget.max_chars : 2000;
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (disabled || !text.trim()) return;
    onAnswer({ response: { kind: 'text', text: text.trim() }, ...(conf ? { confidence: conf } : {}) });
  }
  const near = text.length > max * 0.9;
  return (
    <form className="stack-16" onSubmit={submit}>
      <div className="stack-6">
        <textarea
          ref={ref}
          id={id}
          rows={4}
          className="textarea"
          value={text}
          maxLength={max}
          disabled={disabled}
          aria-labelledby={promptId}
          aria-label={promptId ? undefined : 'Your explanation'}
          aria-describedby={counterId}
          placeholder="In your own words"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
        <span id={counterId} className={`char-count${near ? ' near' : ''}`} aria-live={near ? 'polite' : 'off'}>
          {text.length} / {max}
        </span>
      </div>
      {widget.ask_confidence ? (
        <fieldset className="plain-fieldset conf-row">
          <legend className="conf-legend">How sure are you?</legend>
          <div className="conf-options">
            {([1, 2, 3, 4, 5] as const).map((n) => (
              <label key={n} className={`conf-opt${conf === n ? ' checked' : ''}`}>
                <input
                  type="radio"
                  name={`${id}-conf`}
                  className="visually-hidden-input"
                  aria-label={n === 1 ? '1, guessing' : n === 5 ? '5, certain' : String(n)}
                  checked={conf === n}
                  disabled={disabled}
                  onChange={() => setConf(n)}
                />
                {n}
              </label>
            ))}
          </div>
          <span className="small muted">1 = guessing · 5 = certain</span>
        </fieldset>
      ) : null}
      <div className="widget-row">
        <button type="submit" className="btn btn-primary" disabled={disabled || !text.trim()}>
          {submitLabel ?? 'Submit explanation'}
        </button>
        {widget.allow_unsure ? (
          <button type="button" className="btn btn-secondary" disabled={disabled} onClick={onUnsure}>
            I'm not sure
          </button>
        ) : null}
      </div>
    </form>
  );
}

function StepsWidget({
  widget,
  disabled,
  onAnswer,
  submitLabel,
  autoFocus,
}: WidgetProps & { widget: Extract<Widget, { kind: 'steps' }> }) {
  const [values, setValues] = useState<string[]>(() => widget.steps.map((s) => s.given ?? ''));
  const [err, setErr] = useState<string | null>(null);
  const base = useId();
  const firstBlank = widget.steps.findIndex((s) => s.given == null);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const missing = widget.steps.findIndex((s, i) => s.given == null && !values[i].trim());
    if (missing !== -1) return setErr(`Fill in step ${missing + 1} first.`);
    const bad = widget.steps.findIndex((s, i) => s.given == null && !looksNumeric(values[i]));
    if (bad !== -1) return setErr(`Step ${bad + 1}: enter a number like 8.3, or a fraction like 1/12.`);
    setErr(null);
    onAnswer({
      response: {
        kind: 'steps',
        values: widget.steps.map((s, i) => (s.given != null ? s.given : values[i].trim().replace(/%\s*$/, '').trim())),
      },
    });
  }
  return (
    <form className="stack-16" onSubmit={submit} noValidate>
      <ol className="steps-list">
        {widget.steps.map((s, i) => {
          const id = `${base}-${i}`;
          return (
            <li key={i} className="step-row">
              <span className="step-num" aria-hidden="true">
                {i + 1}
              </span>
              <label htmlFor={s.given == null ? id : undefined} className="step-label">
                {inline(s.label)}
              </label>
              {s.given != null ? (
                <span className="step-given" aria-label={`Step ${i + 1}, given: ${s.given}${s.unit}`}>
                  {s.given}
                  {s.unit}
                </span>
              ) : (
                <UnitInput
                  id={id}
                  value={values[i]}
                  onChange={(v) => {
                    const next = [...values];
                    next[i] = v;
                    setValues(next);
                    if (err) setErr(null);
                  }}
                  unit={s.unit}
                  disabled={disabled}
                  autoFocus={autoFocus && i === firstBlank}
                />
              )}
            </li>
          );
        })}
      </ol>
      {err ? (
        <p className="field-error" role="alert">
          {err}
        </p>
      ) : null}
      <div className="widget-row">
        <button type="submit" className="btn btn-primary" disabled={disabled}>
          {submitLabel ?? 'Check my steps'}
        </button>
      </div>
    </form>
  );
}
