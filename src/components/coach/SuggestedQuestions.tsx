import { Icon } from '../ui/Icon'

type SuggestedQuestionsProps = {
  questions: string[]
  onPick: (question: string) => void
  disabled?: boolean
}

export function SuggestedQuestions({
  questions,
  onPick,
  disabled,
}: SuggestedQuestionsProps) {
  return (
    <div className="coach-suggestions">
      <span className="eyebrow">Suggested questions</span>
      <div className="coach-suggestions__list">
        {questions.map((question) => (
          <button
            type="button"
            className="coach-suggestion"
            key={question}
            onClick={() => onPick(question)}
            disabled={disabled}
          >
            <Icon name="spark" size={12} />
            {question}
          </button>
        ))}
      </div>
    </div>
  )
}
