import type { ReactElement, ReactNode } from 'react';
import { Typography } from 'antd';

export type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  extra?: ReactNode;
};

export function PageHeader(props: PageHeaderProps): ReactElement {
  return (
    <div className="page-header">
      <div className="page-header-copy">
        {props.eyebrow ? <div className="page-eyebrow">{props.eyebrow}</div> : null}
        <Typography.Title level={2} className="page-title">
          {props.title}
        </Typography.Title>
        {props.description ? (
          <Typography.Paragraph className="page-subtitle">{props.description}</Typography.Paragraph>
        ) : null}
      </div>
      {props.extra || props.actions ? (
        <div className="page-header-extra">
          {props.extra}
          {props.actions}
        </div>
      ) : null}
    </div>
  );
}

export function CardHeading(props: { title: string }): ReactElement {
  return (
    <div className="card-heading">
      <span className="card-heading-dot" />
      <span className="card-heading-title">{props.title}</span>
    </div>
  );
}
