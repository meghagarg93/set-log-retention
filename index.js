const AWS = require('aws-sdk');
const ec2 = new AWS.EC2();
const sns = new AWS.SNS();

exports.handler = async (event, context) => {
    try {
        // Get a list of all AWS regions
        const regionData = await ec2.describeRegions({}).promise();
        const regions = regionData.Regions.map(region => region.RegionName);

        console.log("regions : " + regions)

        // Create an empty array to store log group details
        const logGroupDetails = [];

        // Loop through each region and set the retention policy for eligible log groups
        for (const region of regions) {

            let cloudwatchlogs = new AWS.CloudWatchLogs({ region });

            console.log(`Setting retention for log groups in ${region}`);

            let nextToken = null;
            while (true) {
                const logGroupData = await cloudwatchlogs.describeLogGroups({
                    logGroupNamePrefix: '/aws/amazonmq/broker/b-0b19833f-cc13-417b-8af2-586aee8a2e9c/connection',
                    nextToken: nextToken
                }).promise();
                const logGroups = logGroupData.logGroups;


                console.log("log group count: " + logGroups.length)

                for (const logGroup of logGroups) {
                    const logGroupName = logGroup.logGroupName;
                    const retentionInDays = logGroup.retentionInDays;

                    console.log("logGroupName:  " + logGroupName + '\t' + "retentionInDays : " + retentionInDays);

                    if (retentionInDays === undefined) {
                        // If the log group has "never expire" retention policy, set a custom retention policy

                        console.log("retention is never expire");
                        let customRetentionDays;
                        const logGroupNameLowerCase = logGroupName.toLowerCase();

                        console.log("logGroupNameLowerCase: " + logGroupNameLowerCase);
                        if (logGroupNameLowerCase.includes('cloudtrail')) {
                            customRetentionDays = 90;
                        } else if (logGroupNameLowerCase.includes('codebuild')) {
                            customRetentionDays = 1;
                        } else {
                            customRetentionDays = 30;
                        }

                        await cloudwatchlogs.putRetentionPolicy({
                            logGroupName: logGroupName,
                            retentionInDays: customRetentionDays
                        }).promise();
                        console.log(`Custom retention set for ${logGroupName} in ${region}`);

                        // Add log group details to the array
                        logGroupDetails.push({
                            region: region,
                            logGroupName: logGroupName,
                            retentionInDays: customRetentionDays
                        });
                    } else {
                        console.log(`Log group ${logGroupName} in ${region} has a custom retention policy and will not be updated.`);
                    }
                }

                if (!logGroupData.nextToken) break;
                nextToken = logGroupData.nextToken;
            }
        }

        console.log(logGroupDetails);

        // Publish the log group details to the SNS topic
        const snsParams = {
            Message: JSON.stringify(logGroupDetails, null, 2),
            TopicArn: 'arn:aws:sns:us-west-2:567434252311:Inspector_to_Email',
            Subject: "Thor Retention Policy Update",
        };

        await sns.publish(snsParams).promise();

        return {
            statusCode: 200,
            body: 'Retention policy set for eligible log groups in all regions.'
        };
    } catch (err) {
        console.error('Error:', err);
        const snsParams = {
            Message: JSON.stringify(logGroupDetails, null, 2),
            TopicArn: 'arn:aws:sns:us-west-2:567434252311:Inspector_to_Email',
            Subject: "Error in Setting Thor Retention Policy",
        };

        await sns.publish(snsParams).promise();
        throw error;
    }
};
