import { monthGrid, monthLabelForDate, todayId } from '../../domain/time.ts';
import styles from './mini-calendar.module.css';

interface MiniCalendarProps {
  dateId: string;
}

export function MiniCalendar({ dateId }: MiniCalendarProps) {
  const today = todayId();
  const cells = monthGrid(dateId);
  return (
    <div className={styles.root} aria-label={`${monthLabelForDate(dateId)} calendar minimap`}>
      <span className={styles.month}>{monthLabelForDate(dateId)}</span>
      <div className={styles.grid} aria-hidden="true">
        {cells.map((cell) => {
          const classNames = [styles.cell];
          if (cell.outside) classNames.push(styles.outside);
          if (cell.dateId === today) classNames.push(styles.today);
          if (cell.dateId === dateId) classNames.push(styles.selected);
          if (cell.dateId === today && cell.dateId === dateId) classNames.push(styles.both);
          return <span key={cell.dateId} className={classNames.join(' ')} />;
        })}
      </div>
    </div>
  );
}
