import { describe, expect, it } from 'vitest'
import { checkForFalseCompletionClaim } from './completion-claim-guard'

describe('checkForFalseCompletionClaim (task 20, Part A2)', () => {
  describe('completion claims -- the production evidence pattern', () => {
    it('allows a completion claim only when the caller supplies verified write-executed evidence for this turn', () => {
      const result = checkForFalseCompletionClaim('Task has been successfully created.', 'en', {
        verifiedWriteExecutedInTurn: true,
      })
      expect(result.flagged).toBe(false)
      expect(result.text).toBe('Task has been successfully created.')
    })

    it('still strips the same completion claim when no write executed in this turn', () => {
      const result = checkForFalseCompletionClaim('Task has been successfully created.', 'en')
      expect(result.flagged).toBe(true)
      expect(result.text).not.toContain('successfully created')
    })
    it('FA: the exact production evidence sentence is flagged and replaced', () => {
      const reply = 'این Task و Reminder با موفقیت تنظیم شدند.'
      const result = checkForFalseCompletionClaim(reply, 'fa')
      expect(result.flagged).toBe(true)
      expect(result.matchedKind).toBe('completion_claim')
      expect(result.text).not.toBe(reply)
      expect(result.text).not.toContain('تنظیم شدند')
    })

    it('EN: "successfully created" is flagged', () => {
      const result = checkForFalseCompletionClaim('Your task has been successfully created.', 'en')
      expect(result.flagged).toBe(true)
    })

    it('EN: "I\'ve created that for you" (first person) is flagged', () => {
      const result = checkForFalseCompletionClaim("Done! I've created that for you.", 'en')
      expect(result.flagged).toBe(true)
    })

    it('EN: "is now scheduled" is flagged', () => {
      const result = checkForFalseCompletionClaim('Your reminder is now scheduled for tomorrow.', 'en')
      expect(result.flagged).toBe(true)
    })

    it('DE: "wurde erfolgreich erstellt" is flagged', () => {
      const result = checkForFalseCompletionClaim('Deine Aufgabe wurde erfolgreich erstellt.', 'de')
      expect(result.flagged).toBe(true)
    })

    it('a plain, honest, non-completion reply is NOT flagged', () => {
      const reply = "Here's what I'd set up: a daily study task and two daily reminders. Want me to prepare this so you can approve it?"
      const result = checkForFalseCompletionClaim(reply, 'en')
      expect(result.flagged).toBe(false)
      expect(result.text).toBe(reply)
    })

    it('FA: an honest, non-completion reply is NOT flagged', () => {
      const reply = 'این چیزی است که تنظیم می‌کردم: یک تسک روزانه مطالعه. می‌خواهی آماده‌اش کنم؟'
      const result = checkForFalseCompletionClaim(reply, 'fa')
      expect(result.flagged).toBe(false)
    })
  })

  describe('fabricated explanations for a non-existent result (the amendment: second-order lie)', () => {
    it('EN: "display delay" is flagged', () => {
      const result = checkForFalseCompletionClaim("It should appear shortly — sometimes there's a display delay.", 'en')
      expect(result.flagged).toBe(true)
      expect(result.matchedKind).toBe('fabricated_explanation')
    })

    it('EN: "I\'ve re-submitted it" is flagged', () => {
      const result = checkForFalseCompletionClaim("I've re-submitted it, please check again.", 'en')
      expect(result.flagged).toBe(true)
      expect(result.matchedKind).toBe('fabricated_explanation')
    })

    it('FA: "به‌زودی نمایش داده می‌شود" is flagged', () => {
      const result = checkForFalseCompletionClaim('به‌زودی نمایش داده می‌شود، گاهی تاخیر پیش می‌آید.', 'fa')
      expect(result.flagged).toBe(true)
    })

    it('DE: "Anzeigeverzögerung" is flagged', () => {
      const result = checkForFalseCompletionClaim('Es sollte gleich erscheinen — manchmal gibt es eine Anzeigeverzögerung.', 'de')
      expect(result.flagged).toBe(true)
    })
  })

  describe('false-positive bounding -- the user\'s own words / past-tense discussion of something the user did themselves', () => {
    it('EN: an explicit "you\'ve already" subject IMMEDIATELY before the completion verb is NOT flagged', () => {
      const result = checkForFalseCompletionClaim("You've already successfully created that task, so I won't duplicate it.", 'en')
      expect(result.flagged).toBe(false)
    })

    it('EN: "your team has already" immediately before the verb is NOT flagged', () => {
      const result = checkForFalseCompletionClaim('Your team has already successfully set up that reminder.', 'en')
      expect(result.flagged).toBe(false)
    })

    it('FA: "شما قبلاً" (you already) immediately before the verb is NOT flagged', () => {
      const result = checkForFalseCompletionClaim('شما قبلاً با موفقیت آن را تنظیم کرده‌اید.', 'fa')
      expect(result.flagged).toBe(false)
    })

    it('the target production bug is NOT excluded by a merely-nearby possessive: "Your task ... has been successfully created" is a false claim about an object the user owns, not a real 2nd-person attribution, and MUST still be flagged', () => {
      // This is the regression this narrow, ANCHORED exclusion exists to
      // avoid: an earlier, wider "pronoun anywhere in a 60-char window"
      // design wrongly treated the possessive "Your" (three words before
      // the verb, modifying the OBJECT "task") as if it were the verb's own
      // subject, silently missing the exact production evidence sentence.
      const result = checkForFalseCompletionClaim('Your task and two reminders have been successfully created.', 'en')
      expect(result.flagged).toBe(true)
    })

    it('documented residual risk: a bare passive construction with NO pronoun anywhere is still flagged (biased toward catching a real lie over avoiding every false positive)', () => {
      const result = checkForFalseCompletionClaim('It has been created already, as discussed.', 'en')
      expect(result.flagged).toBe(true)
    })
  })

  describe('neutral replacement copy is calm and offers to prepare the action', () => {
    it('EN replacement mentions approval, not just a bare correction', () => {
      const result = checkForFalseCompletionClaim('Successfully created your task.', 'en')
      expect(result.text.toLowerCase()).toContain('approval')
    })

    it('every language has its own replacement text (not falling back to English)', () => {
      const en = checkForFalseCompletionClaim('Successfully created.', 'en').text
      const de = checkForFalseCompletionClaim('Erfolgreich erstellt.', 'de').text
      const fa = checkForFalseCompletionClaim('با موفقیت ایجاد شد.', 'fa').text
      expect(en).not.toBe(de)
      expect(de).not.toBe(fa)
      expect(fa).not.toBe(en)
    })
  })
})
