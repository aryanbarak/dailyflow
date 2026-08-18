import { useState } from 'react';
import { Gamepad2 } from 'lucide-react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { useT } from '@/i18n';
import { useMicroBreaksStore } from '../store/microBreaksStore';

// ADR-0014 §10: desktop entry point -- a command-palette action, built from
// the existing shadcn/cmdk primitives in @/components/ui/command.tsx (no
// prior command-palette feature existed in this repo to extend; this is a
// small, dedicated palette rather than a new generalized command system).
export function MicroBreaksCommandLauncher() {
  const [open, setOpen] = useState(false);
  const { t } = useT();
  const startBreak = useMicroBreaksStore(s => s.startBreak);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('micro_breaks_entry_label')}
        title={t('micro_breaks_entry_label')}
        className="flex items-center justify-center h-7 w-7 rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
      >
        <Gamepad2 size={14} />
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder={t('micro_breaks_entry_label')} />
        <CommandList>
          <CommandEmpty>{t('no_results')}</CommandEmpty>
          <CommandGroup>
            <CommandItem
              onSelect={() => {
                setOpen(false);
                startBreak();
              }}
            >
              <Gamepad2 className="mr-2 h-4 w-4" />
              {t('micro_breaks_entry_label')}
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
