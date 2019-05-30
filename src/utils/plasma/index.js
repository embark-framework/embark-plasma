import { post } from "axios";

export async function getWatcherStatus(watcherUrl) {
  const response = await post(`${watcherUrl}/status.get`);
  if (!(response.status === 200 && response.data && response.data.success)) {
    throw new Error(`Error getting status of the Plasma watcher`);
  }
  return response.data.data;
}
