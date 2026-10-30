import { execSync } from 'node:child_process';
export function deleteShipment({ recordId }) {
  return execSync(`warehouse-delete --record ${recordId}`, { encoding: 'utf8' });
}
