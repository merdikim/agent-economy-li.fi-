import Groq from "groq-sdk";
import { ChatCompletionMessage } from "groq-sdk/resources/chat.mjs";

export class Agent {
  private client: Groq;
  private systemPrompt: string;

  constructor(systemPrompt: string) {
    this.client = new Groq({ apiKey: process.env.GROQ_API_KEY });
    this.systemPrompt = systemPrompt;
  }

  async ask(prompt: string): Promise<ChatCompletionMessage> {
    const result = await this.client.chat.completions.create({
      model: 'openai/gpt-oss-20b',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: prompt },
      ],
    });

    return result.choices[0].message;
  }
}

export function extractJsonBlock<T>(agentResponse: ChatCompletionMessage): T {
  const text = agentResponse.content || '';
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1]) as T;
  }

  const genericFence = text.match(/```\s*([\s\S]*?)\s*```/i);
  if (genericFence?.[1]) {
    return JSON.parse(genericFence[1]) as T;
  }

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (!objectMatch?.[0]) {
    throw new Error('No JSON block found in model output');
  }

  return JSON.parse(objectMatch[0]) as T;
}
