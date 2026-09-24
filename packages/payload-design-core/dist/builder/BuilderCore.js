'use client';
import { jsx as _jsx } from "react/jsx-runtime";
import { DndContext, KeyboardSensor, PointerSensor, pointerWithin, useSensor, useSensors, } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
export function BuilderCore({ children, id, onInsert, onMove, }) {
    const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
    function dragEnd(event) {
        const containerID = event.over?.data.current?.containerID;
        if (!containerID)
            return;
        const library = event.active.data.current?.library;
        if (library) {
            onInsert(library, containerID);
            return;
        }
        const nodeID = event.active.data.current?.nodeID;
        if (nodeID)
            onMove(nodeID, containerID);
    }
    return (_jsx(DndContext, { id: id, sensors: sensors, collisionDetection: pointerWithin, onDragEnd: dragEnd, children: children }));
}
