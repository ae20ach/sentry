import {NotOpRow} from 'sentry/views/alerts/rules/uptime/assertions/assertionFailure/rows/notOpRow';
import type {UptimeNotOp} from 'sentry/views/alerts/rules/uptime/types';

import {TreeNode} from './treeNode';

export class NotOpTreeNode extends TreeNode<UptimeNotOp> {
  override get nextOps() {
    return [this.value.operand];
  }

  printNode(): string {
    return `NOT - ${this.id}`;
  }

  renderRow(): React.ReactNode {
    return <NotOpRow />;
  }
}
