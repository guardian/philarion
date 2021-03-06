import { HealthCheck } from "@aws-cdk/aws-autoscaling";
import { ApplicationProtocol, ListenerAction, Protocol, TargetType } from "@aws-cdk/aws-elasticloadbalancingv2";
import type { App } from "@aws-cdk/core";
import { Duration, Tags } from "@aws-cdk/core";
import { InstanceRole } from "@guardian/cdk";
import { GuAutoScalingGroup } from "@guardian/cdk/lib/constructs/autoscaling";
import {
  GuArnParameter,
  GuParameter,
  GuStringParameter,
} from "@guardian/cdk/lib/constructs/core";
import type { GuStackProps } from "@guardian/cdk/lib/constructs/core/stack";
import { GuStack } from "@guardian/cdk/lib/constructs/core/stack";
import { GuSecurityGroup, GuVpc } from "@guardian/cdk/lib/constructs/ec2";
import {
  GuApplicationListener,
  GuApplicationLoadBalancer,
  GuApplicationTargetGroup,
} from "@guardian/cdk/lib/constructs/loadbalancing";
import { GuGetS3ObjectPolicy, GuPolicy } from "@guardian/cdk/lib/constructs/iam";
import { Effect, PolicyStatement } from "@aws-cdk/aws-iam";
import { transformToCidrIngress } from "@guardian/cdk/lib/utils";

export class RuleManager extends GuStack {
  constructor(scope: App, id: string, props: GuStackProps) {
    super(scope, id, props);

    const parameters = {
      VPC: new GuParameter(this, "VPC", {
        type: "AWS::SSM::Parameter::Value<AWS::EC2::VPC::Id>",
        description: "Virtual Private Cloud to run EC2 instances within",
        default: "/account/vpc/default/id"
      }),
      PublicSubnets: new GuParameter(this, "PublicSubnets", {
        type: "AWS::SSM::Parameter::Value<List<AWS::EC2::Subnet::Id>>",
        description: "Subnets to run load balancer within",
        default: "/account/vpc/default/public.subnets"
      }),
      PrivateSubnets: new GuParameter(this, "PrivateSubnets", {
        type: "AWS::SSM::Parameter::Value<List<AWS::EC2::Subnet::Id>>",
        description: "Subnets to run the ASG and instances within",
        default: "/account/vpc/default/private.subnets"
      }),
      TLSCert: new GuArnParameter(this, "TLSCert", {
        description: "ARN of a TLS certificate to install on the load balancer",
      }),
      AMI: new GuStringParameter(this, "AMI", {
        description: "AMI ID",
      }),
      ClusterName: new GuStringParameter(this, "ClusterName", {
        description: "The value of the ElasticSearchCluster tag that this instance should join",
        default: "elk",
      })
    };

    Tags.of(this).add("ElasticSearchCluster", parameters.ClusterName.valueAsString);

    const vpc = GuVpc.fromId(this, "vpc", parameters.VPC.valueAsString);

    const pandaAuthPolicy = new GuGetS3ObjectPolicy(this, "PandaAuthPolicy", { bucketName: "pan-domain-auth-settings" });

    const ruleManagerRole = new InstanceRole(this, {
      bucketName: "composer-dist",
      additionalPolicies: [pandaAuthPolicy]
    });

    const targetGroup = new GuApplicationTargetGroup(this, "PublicTargetGroup", {
      vpc: vpc,
      port: 9000,
      protocol: ApplicationProtocol.HTTP,
      targetType: TargetType.INSTANCE,
      healthCheck: {
        port: "9000",
        protocol: Protocol.HTTP,
        path: "/healthcheck",
        interval: Duration.minutes(1),
        timeout: Duration.seconds(3),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
      },
      deregistrationDelay: Duration.seconds(30),
    });

    const ingressRules = {
      "Global": "0.0.0.0/0"
    }

    const loadBalancerSecurityGroup = new GuSecurityGroup(this, "LoadBalancerSecurityGroup", {
      description: "Security group to allow internet access to the LB",
      vpc,
      allowAllOutbound: false,
      ingresses: transformToCidrIngress(Object.entries(ingressRules))
    });

    const privateSubnets = GuVpc.subnets(this, parameters.PrivateSubnets.valueAsList);
    const publicSubnets = GuVpc.subnets(this, parameters.PublicSubnets.valueAsList);

    const loadBalancer = new GuApplicationLoadBalancer(this, "PublicLoadBalancer", {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnets: publicSubnets },
      securityGroup: loadBalancerSecurityGroup,
    });

    new GuApplicationListener(this, "PublicListener", {
      loadBalancer,
      certificates: [{ certificateArn: parameters.TLSCert.valueAsString }],
      defaultAction: ListenerAction.forward([targetGroup]),
      open: false,
    });

    const appSecurityGroup = new GuSecurityGroup(this, "ApplicationSecurityGroup", {
      description: "HTTP",
      vpc,
      allowAllOutbound: true,
    });

    const userData = `#!/bin/bash -ev
mkdir /etc/gu

cat > /etc/gu/typerighter-rule-manager.conf <<-'EOF'
    include "application"
EOF

aws --quiet --region ${this.region} s3 cp s3://composer-dist/${this.stack}/${this.stage}/typerighter-rule-manager/typerighter-rule-manager.deb /tmp/package.deb
dpkg -i /tmp/package.deb`;

    new GuAutoScalingGroup(this, "AutoscalingGroup", {
      vpc,
      vpcSubnets: { subnets: privateSubnets },
      role: ruleManagerRole,
      imageId: parameters.AMI.valueAsString,
      userData: userData,
      instanceType: "t4g.micro",
      minCapacity: 1,
      maxCapacity: 2,
      healthCheck: HealthCheck.elb({
        grace: Duration.minutes(5),
      }),
      targetGroup,
      securityGroup: appSecurityGroup,
      associatePublicIpAddress: false,
    });
  }
}