/**
 * `<sm-capture-level-selector>`, the capture-ladder control (spec
 * `provider-activity.md` §Capture level): five cumulative positions,
 * moved live. Mounted beside the Record control in the Sessions rail
 * (choosing how deep a recording sees is part of the record gesture)
 * and mirrored in Settings > Project.
 *
 * The `shell` position unlocks only with the install-side opt-in
 * (`sm activity install claude --shell`, spec §Capture level rung 5:
 * double opt-in by design, command lines are operator content); until
 * then it renders disabled so the ladder's shape stays honest.
 */

import { ChangeDetectionStrategy, Component, computed, inject, input, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectButton, SelectButtonModule } from 'primeng/selectbutton';
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
  /**
   * Locked = the shell rung without its install opt-in. NOT a native
   * disable (that swallows the pointer events the explanatory tooltip
   * needs): the option renders muted with `aria-disabled`, `onChange`
   * refuses the selection, and the tooltip names the fix. Same dialect
   * as the workspace's gated Sessions tab.
   */
  readonly locked: boolean;
  readonly tooltip: string;
}

@Component({
  selector: 'sm-capture-level-selector',
  imports: [FormsModule, SelectButtonModule, TooltipModule],
  template: `
    <p-selectbutton
      [options]="options()"
      optionLabel="label"
      optionValue="value"
      [allowEmpty]="false"
      [ngModel]="service.level()"
      (ngModelChange)="onChange($event)"
      [disabled]="service.busy() || recorder.recording() || disabled()"
      size="small"
      [pTooltip]="recorder.recording() ? texts.lockedWhileRecording : ''"
      tooltipPosition="bottom"
      [attr.aria-label]="texts.label"
      data-testid="capture-level-selector"
    >
      <!-- Per-option tooltip (what each rung shows; the locked shell
           position explains itself, pointing at Settings unless the
           selector already sits there). The click itself is refused in
           onChange, tooltip and refusal are separate mechanisms. -->
      <ng-template let-option pTemplate="item">
        <span
          class="capture-level-option"
          [class.capture-level-option--locked]="option.locked"
          [attr.aria-disabled]="option.locked ? 'true' : null"
          [pTooltip]="option.tooltip"
          tooltipPosition="bottom"
          >{{ option.label }}</span
        >
      </ng-template>
    </p-selectbutton>
  `,
  styles: `
    .capture-level-option--locked {
      color: var(--sm-text-muted);
      cursor: not-allowed;
    }
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

  /**
   * External gate (the Settings mirror disables the whole control while
   * the activity hook is KNOWN missing; the host row explains why).
   */
  readonly disabled = input(false);

  /**
   * Set by the Settings mirror: its capture-level row already carries
   * the unlock command, so the locked shell tooltip drops the
   * "see Settings" pointer there (user call 2026-08-17) and describes
   * the rung like any other option.
   */
  readonly settingsHost = input(false);

  private readonly selectButton = viewChild(SelectButton);

  protected readonly options = computed<ILevelOption[]>(() =>
    CAPTURE_LEVELS.map((value) => ({
      label: CAPTURE_LEVEL_TEXTS.levels[value],
      value,
      // The shell rung unlocks only with the install-side opt-in
      // (spec §Capture level rung 5, double opt-in by design).
      locked: value === 'shell' && !this.service.shellCapture(),
      tooltip:
        value === 'shell' && !this.service.shellCapture() && !this.settingsHost()
          ? CAPTURE_LEVEL_TEXTS.tooltips.shellLocked
          : CAPTURE_LEVEL_TEXTS.tooltips[value],
    })),
  );

  /**
   * Non-null guard (`allowEmpty=false` still types the event loosely),
   * plus the locked-shell refusal: PrimeNG has already flipped its
   * internal value by the time this fires, so the rejection writes the
   * REAL level back through the public CVA seam, no flicker, no
   * request. Options are not natively disabled on purpose: a disabled
   * button swallows pointer events and the explanatory tooltip dies
   * with them (field feedback 2026-08-17).
   */
  protected onChange(next: TCaptureLevel | null): void {
    if (next === null) return;
    if (next === 'shell' && !this.service.shellCapture()) {
      this.selectButton()?.writeValue(this.service.level());
      return;
    }
    void this.service.set(next);
  }
}
