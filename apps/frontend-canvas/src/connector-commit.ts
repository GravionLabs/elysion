import { CaptureUpdateAction } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ConnectorResult } from './connector';

/**
 * Writes a connector (and anything made with it, such as a new sticky note) into the scene in **one** update, so one
 * undo takes it all back, and selects `select` (the connector by default). The two shapes the connector joins are
 * replaced by their updated copies; deleted elements stay in the scene as the tombstones the sync relies on.
 */
export function commitConnector(
  api: ExcalidrawImperativeAPI,
  { arrow, updated }: ConnectorResult,
  options: { extra?: readonly ExcalidrawElement[]; select?: string } = {},
): void {
  const replacement = new Map(updated.map((shape) => [shape.id, shape]));
  const swap = (element: ExcalidrawElement) => replacement.get(element.id) ?? element;
  api.updateScene({
    elements: [
      ...api.getSceneElementsIncludingDeleted().map(swap),
      ...(options.extra ?? []).map(swap),
      arrow,
    ],
    appState: { selectedElementIds: { [options.select ?? arrow.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}
