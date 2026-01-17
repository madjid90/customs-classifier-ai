import { NextQuestion, QuestionOption } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpCircle } from "lucide-react";
import { useState } from "react";

interface QuestionFormProps {
  question: NextQuestion;
  onAnswer: (questionId: string, answer: string) => void;
  isSubmitting: boolean;
}

export function QuestionForm({ question, onAnswer, isSubmitting }: QuestionFormProps) {
  const [answer, setAnswer] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!answer.trim()) return;
    onAnswer(question.id, answer);
  };

  const handleOptionSelect = (value: string) => {
    setAnswer(value);
    onAnswer(question.id, value);
  };

  return (
    <Card className="border-accent/30 bg-accent/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <HelpCircle className="h-5 w-5 text-accent" />
          Information requise
        </CardTitle>
        <CardDescription>
          Repondez a cette question pour affiner la classification
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-base font-medium">{question.label}</Label>
            
            {question.type === "yesno" && (
              <RadioGroup
                value={answer}
                onValueChange={handleOptionSelect}
                className="flex gap-4"
                disabled={isSubmitting}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="yes" id="yes" />
                  <Label htmlFor="yes" className="cursor-pointer">Oui</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="no" id="no" />
                  <Label htmlFor="no" className="cursor-pointer">Non</Label>
                </div>
              </RadioGroup>
            )}

            {question.type === "select" && question.options && (
              <RadioGroup
                value={answer}
                onValueChange={handleOptionSelect}
                className="space-y-2"
                disabled={isSubmitting}
              >
                {question.options.map((option: QuestionOption) => (
                  <div key={option.value} className="flex items-center space-x-2">
                    <RadioGroupItem value={option.value} id={option.value} />
                    <Label htmlFor={option.value} className="cursor-pointer">
                      {option.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            )}

            {question.type === "text" && (
              <div className="space-y-2">
                <Input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Votre reponse..."
                  disabled={isSubmitting}
                />
                <Button type="submit" disabled={isSubmitting || !answer.trim()}>
                  Valider
                </Button>
              </div>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
