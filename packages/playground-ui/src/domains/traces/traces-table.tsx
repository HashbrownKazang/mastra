import { Skeleton } from '@/components/ui/skeleton';
import { Table, Tbody, Th, Row, Cell, DateTimeCell, UnitCell, TxtCell } from '@/ds/components/Table';

import { Thead } from '@/ds/components/Table';
import type { RefinedTrace } from '@/domains/traces/types';
import { Badge } from '@/ds/components/Badge';
import { TraceIcon } from '@/ds/icons/TraceIcon';
import { useOpenTrace } from './hooks/use-open-trace';
import { Txt } from '@/ds/components/Txt';
import { useContext } from 'react';
import { TraceContext } from './context/trace-context';

const TracesTableSkeleton = ({ colsCount }: { colsCount: number }) => {
  return (
    <Tbody>
      <Row>
        {Array.from({ length: colsCount }).map((_, index) => (
          <Cell key={index}>
            <Skeleton className="w-1/2" />
          </Cell>
        ))}
      </Row>
    </Tbody>
  );
};

const TracesTableEmpty = ({ colsCount }: { colsCount: number }) => {
  return (
    <Tbody>
      <Row>
        <Cell colSpan={colsCount} className="text-center py-4">
          <Txt>No traces found</Txt>
        </Cell>
      </Row>
    </Tbody>
  );
};

const TracesTableError = ({ error, colsCount }: { error: { message: string }; colsCount: number }) => {
  return (
    <Tbody>
      <Row>
        <Cell colSpan={colsCount} className="text-center py-4">
          <Txt>{error.message}</Txt>
        </Cell>
      </Row>
    </Tbody>
  );
};

export interface TracesTableProps {
  traces: RefinedTrace[];
  isLoading: boolean;
  error?: { message: string } | null;
}

const TraceRow = ({ trace, index, isActive }: { trace: RefinedTrace; index: number; isActive: boolean }) => {
  const { openTrace } = useOpenTrace();

  return (
    <Row className={isActive ? 'bg-surface4' : ''}>
      <DateTimeCell dateTime={new Date(trace.started / 1000)} />
      <TxtCell>{trace.traceId}</TxtCell>
      <UnitCell unit="ms">{trace.duration / 1000}</UnitCell>
      <Cell>
        <button onClick={() => openTrace(trace.trace, index)}>
          <Badge icon={<TraceIcon />}>
            {trace.trace.length} span{trace.trace.length > 1 ? 's' : ''}
          </Badge>
        </button>
      </Cell>
    </Row>
  );
};

export const TracesTable = ({ traces, isLoading, error }: TracesTableProps) => {
  const hasNoTraces = !traces || traces.length === 0;
  const { currentTraceIndex } = useContext(TraceContext);
  const colsCount = 4;

  return (
    <Table size="small">
      <Thead>
        <Th width={160}>Time</Th>
        <Th width="auto">Trace Id</Th>
        <Th width={160}>Duration</Th>
        <Th width={160}>Spans</Th>
      </Thead>
      {isLoading ? (
        <TracesTableSkeleton colsCount={colsCount} />
      ) : error ? (
        <TracesTableError error={error} colsCount={colsCount} />
      ) : hasNoTraces ? (
        <TracesTableEmpty colsCount={colsCount} />
      ) : (
        <Tbody>
          {traces.map((trace, index) => (
            <TraceRow key={trace.traceId} trace={trace} index={index} isActive={index === currentTraceIndex} />
          ))}
        </Tbody>
      )}
    </Table>
  );
};
