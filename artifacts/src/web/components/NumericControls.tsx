'use client';
import { useId, type ReactNode } from 'react';
import { Slider as BaseSlider } from '@base-ui/react/slider';
import { NumberField as BaseNumberField } from '@base-ui/react/number-field';
import './NumericControls.css';

type SliderProps = Omit<BaseSlider.Root.Props<number>, 'children' | 'className' | 'orientation'> & { label: ReactNode; hint?: ReactNode; className?: string; showValue?: boolean };

export function Slider({ label, hint, className = '', showValue = true, ...props }: SliderProps) {
  const hintId = useId();
  return <BaseSlider.Root {...props} className={`ui4a-slider ${className}`}>
    <div className="ui4a-numeric-heading"><BaseSlider.Label className="ui4a-numeric-label">{label}</BaseSlider.Label>{showValue && <BaseSlider.Value className="ui4a-numeric-value" />}</div>
    <BaseSlider.Control className="ui4a-slider-control"><BaseSlider.Track className="ui4a-slider-track"><BaseSlider.Indicator className="ui4a-slider-fill" /><BaseSlider.Thumb className="ui4a-slider-thumb" aria-describedby={hint ? hintId : undefined} /></BaseSlider.Track></BaseSlider.Control>
    {hint && <div id={hintId} className="ui4a-numeric-hint">{hint}</div>}
  </BaseSlider.Root>;
}

type NumberFieldProps = Omit<BaseNumberField.Root.Props, 'children' | 'className'> & { label: ReactNode; hint?: ReactNode; className?: string; placeholder?: string; inputMode?: 'numeric' | 'decimal'; incrementLabel?: string; decrementLabel?: string };

export function NumberField({ label, hint, className = '', id, placeholder, inputMode = 'decimal', incrementLabel = '增加', decrementLabel = '减少', ...props }: NumberFieldProps) {
  const generatedId = useId(), inputId = id ?? generatedId, labelId = `${inputId}-label`, hintId = `${inputId}-hint`;
  return <BaseNumberField.Root {...props} id={inputId} className={`ui4a-number ${className}`}>
    <label id={labelId} htmlFor={inputId} className="ui4a-numeric-label">{label}</label>
    <BaseNumberField.Group className="ui4a-number-group">
      <BaseNumberField.Decrement type="button" className="ui4a-number-step" aria-label={decrementLabel} aria-describedby={labelId}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg></BaseNumberField.Decrement>
      <BaseNumberField.Input inputMode={inputMode} className="ui4a-number-input" placeholder={placeholder} aria-describedby={hint ? hintId : undefined} />
      <BaseNumberField.Increment type="button" className="ui4a-number-step" aria-label={incrementLabel} aria-describedby={labelId}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg></BaseNumberField.Increment>
    </BaseNumberField.Group>
    {hint && <div id={hintId} className="ui4a-numeric-hint">{hint}</div>}
  </BaseNumberField.Root>;
}
