/**
 * `<sm-capture-level-selector>`, the capture-ladder control (spec
 * `provider-activity.md` §Capture level): five cumulative positions,
 * moved live. Mounted beside the Record control in the Sessions rail
 * (choosing how deep a recording sees is part of the record gesture)
 * and mirrored in Settings > Project.
 *
 * `shell` renders but stays DISABLED: the rung is reserved (no capture
 * exists yet; it additionally requires an install-side opt-in when it
 * lands), and showing it keeps the ladder's shape honest instead of
 * springing a sixth option on users later.
 */

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TooltipModule } from 'primeng/tooltip';

import { CAPTURE_LEVEL_TEXTS } from '../../../i18n/capture-level.texts';
import { ActivityRecorderService } from '../../../services/activity-recorder';
import {
  CAPTURE_LEVELS,
  CaptureLevelService,
  type TCaptureLevel,
} from '../../../services/capture-level';

interface ILevelOption {
  readonly label: string;
  readonly value: TCaptureLevel;
  readonly disabled: boolean;
}

@Component({
  selector: 'sm-capture-level-selector',
  imports: [FormsModule, SelectButtonModule, TooltipModule],
  template: `
    <p-selectbutton
      [options]="options"
      optionLabel="label"
      optionValue="value"
      optionDisabled="disabled"
      [allowEmpty]="false"
      [ngModel]="service.level()"
      (ngModelChange)="onChange($event)"
      [disabled]="service.busy() || recorder.recording()"
      size="small"
      [pTooltip]="recorder.recording() ? texts.lockedWhileRecording : texts.description"
      tooltipPosition="bottom"
      [attr.aria-label]="texts.label"
      data-testid="capture-level-selector"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CaptureLevelSelector {
  protected readonly service = inject(CaptureLevelService);
  /**
   * LOCKED while recording (user decision 2026-08-17): a mid-recording
   * move reads as "did it change or not?", so the depth is chosen
   * before pressing Record. The server refuses too; this disable is
   * the honest face of that refusal.
   */
  protected readonly recorder = inject(ActivityRecorderService);
  protected readonly texts = CAPTURE_LEVEL_TEXTS;

  protected readonly options: ILevelOption[] = CAPTURE_LEVELS.map((value) => ({
    label: CAPTURE_LEVEL_TEXTS.levels[value],
    value,
    // Reserved rung: no capture exists yet (see the class doc).
    disabled: value === 'shell',
  }));

  /** Non-null guard: `allowEmpty=false` still types the event loosely. */
  protected onChange(next: TCaptureLevel | null): void {
    if (next !== null) void this.service.set(next);
  }
}
