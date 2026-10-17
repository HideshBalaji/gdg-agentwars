/**
 * Demo mode chat: the agent that owns the conversation answers from the scripted
 * incident state. Live mode sends the message to the ADK agents instead.
 */
import type { AgentId } from '../contract';
import { STAGES } from '../contract';
import { AGENTS } from '../meta';
import { fmtDur, fmtInr, fmtTime, uid } from '../format';
import { apply, nowIso, useStore } from '../store';

export const CHAT_REPLY = 'chat-reply';

function answer(text: string): { agent: AgentId; reply: string } {
  const s = useStore.getState();
  const agent: AgentId = s.incident ? s.owner : 'dispatcher';
  if (!s.incident) {
    return { agent, reply: 'No incident is open yet. Press Simulate breakdown (or 1) and ask me about it as it unfolds.' };
  }
  const plan = s.plans.find((p) => p.id === s.selected?.plan_id);
  const stage = STAGES.find((x) => x.id === s.stage)?.label ?? 'Detect';
  const q = text.toLowerCase();

  if (/why|vehicle|truck|chose|choose|pick/.test(q)) {
    return plan
      ? { agent, reply: `${plan.label}: ${s.selected?.reason ?? 'best feasible option'} It arrives ${fmtTime(plan.arrival_at)} with ${fmtDur(plan.slack_min)} to spare, for ${fmtInr(plan.cost_inr)}.` }
      : { agent, reply: 'No plan is chosen yet. Route & Risk is still finding options and the Validator still has to check them.' };
  }
  if (/cost|price|expensive|cheap|₹|inr/.test(q)) {
    const valid = s.plans.filter((p) => s.verdicts[p.id]?.verdict === 'valid');
    return valid.length
      ? { agent, reply: `Feasible options: ${valid.map((p) => `${p.label} ${fmtInr(p.cost_inr)}`).join(', ')}.${plan ? ` Chosen: ${plan.label}.` : ''}` }
      : { agent, reply: 'There are no validated options with costs yet.' };
  }
  if (/status|where|update|now|progress/.test(q)) {
    const left = s.incident.rescue_deadline ? ` The rescue deadline is ${fmtTime(s.incident.rescue_deadline)}.` : '';
    return { agent, reply: `We are at the ${stage} step${s.incident.status === 'resolved' ? ' and the rescue is complete' : ''}.${left}` };
  }
  if (/fail|kill|break|recover|heal/.test(q)) {
    const n = s.healing.filter((h) => h.result === 'recovered').length;
    return { agent, reply: `${n} recovery step${n === 1 ? '' : 's'} so far. During booking you can kill the carrier from the Now banner (or press K) to watch the fallback.` };
  }
  return {
    agent,
    reply: `Noted. In demo mode I answer from the scripted incident; switch to Live to talk to the real ${AGENTS[agent].name} agent. Try asking “Why this vehicle?” or “What's the status?”.`,
  };
}

export function demoReply(text: string) {
  const { agent, reply } = answer(text);
  apply({ type: 'agent.status', agent, status: 'thinking' });
  setTimeout(() => {
    // Tagged so step summaries keep quoting the incident narrative, not chat answers.
    apply({ type: 'message', message: { id: uid('msg'), at: nowIso(), role: 'agent', agent, author: CHAT_REPLY, text: reply } });
    apply({ type: 'agent.status', agent, status: 'idle' });
  }, 700);
}
