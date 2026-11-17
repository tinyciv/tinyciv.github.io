import type { CampaignStats } from '../game/campaign-stats';
import './campaign-report.css';

export interface CampaignReport extends CampaignStats {
  civilization: string; elapsedSeconds: number; treasury: number; cities: number; culture: number;
}
const escape = (value: string): string => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const whole = (value: number): string => Math.floor(Math.max(0, value)).toLocaleString('en-US');
/** Shared by the real end dialog and its isolated visual preview. */
export function campaignReportMarkup(report: CampaignReport): string {
  const minutes = Math.floor(report.elapsedSeconds / 60), seconds = Math.floor(report.elapsedSeconds % 60);
  const duration = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  const rows: [string, string][] = [
    ['Gold gathered', whole(report.goldGathered)], ['Enemy units killed', whole(report.enemiesKilled)],
    ['Units lost', whole(report.unitsLost)], ['Technologies researched', whole(report.technologiesResearched)],
    ['Maximum population', whole(report.maximumPopulation)], ['Cities controlled', whole(report.cities)],
    ['Gold remaining', whole(report.treasury)], ['Culture earned', whole(report.culture)], ['Time played', duration],
  ];
  return `<section class="campaign-report" aria-label="Campaign statistics"><div class="campaign-civilization">${escape(report.civilization)}</div><dl class="campaign-stat-grid">${rows.map(([label, value]) => `<div class="campaign-stat"><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl></section>`;
}
