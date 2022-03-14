import 'dotenv/config';
import Discord, { Client, TextChannel } from 'discord.js';
import fetch from 'node-fetch';
import { ethers } from "ethers";

const OPENSEA_SHARED_STOREFRONT_ADDRESS = '0x495f947276749Ce646f68AC8c248420045cb7b5e';

const discordBotSales = new Discord.Client();
const discordBotMain = new Discord.Client();
const discordSetup = async (client: Client, channelIdEnvVar: string): Promise<TextChannel> => {
  return new Promise<TextChannel>((resolve, reject) => {
    ['DISCORD_BOT_TOKEN', channelIdEnvVar].forEach((envVar) => {
      if (!process.env[envVar]) reject(`${envVar} not set`)
    })
    client.login(process.env.DISCORD_BOT_TOKEN);
    client.on('ready', async () => {
      const channel = await client.channels.fetch(process.env[channelIdEnvVar]!);
      resolve(channel as TextChannel);
    });
  })
}

const buildMessage = (sale: any) => {
  const isBundle = !sale.asset && sale.asset_bundle?.assets.length > 0;

  let name;
  let url;
  let image;

  if (isBundle) {
    name = `Bundle of ${sale.quantity}`
    url = sale.asset_bundle.permalink;
    image = sale.asset_bundle.assets[0].image_url;
  } else {
    name = sale.asset.name || `#${sale.asset.token_id}`;
    url = sale.asset.permalink;
    image = sale.asset.image_url;
  }

  return (
    new Discord.MessageEmbed()
      .setColor('#0099ff')
      .setTitle(`${name} sold for ${ethers.utils.formatEther(sale.total_price || '0')} ETH`)
      .setURL(url)
      .setImage(image)
  )
}

async function main() {
  const mainChannelMinSale = process.env.DISCORD_MAIN_CHANNEL_MIN_SALE

  const salesChannel = await discordSetup(discordBotSales, 'DISCORD_SALES_CHANNEL_ID');
  let mainChannel;
  if (mainChannelMinSale) {
    mainChannel = await discordSetup(discordBotMain, 'DISCORD_MAIN_CHANNEL_ID');
  }
  const seconds = process.env.SECONDS ? parseInt(process.env.SECONDS) : 3_600;
  // milliseconds format (same as opensea)
  const sinceTimestamp = (Math.round(new Date().getTime() / 1000) - (seconds)) * 1000;

  const params = new URLSearchParams({
    event_type: 'successful',
    only_opensea: 'false',
    collection_slug: process.env.COLLECTION_SLUG!,
  })

  if (process.env.CONTRACT_ADDRESS !== OPENSEA_SHARED_STOREFRONT_ADDRESS) {
    params.append('asset_contract_address', process.env.CONTRACT_ADDRESS!)
  }

  const openSeaResponse = await fetch(
    "https://api.opensea.io/api/v1/events?" + params,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': `${process.env.OPENSEA_API_KEY}`
      },
    }
  ).then((resp) => resp.json());

  return await Promise.all(
    openSeaResponse?.asset_events
      ?.filter(event => {
        const timestamp = new Date(event.transaction.timestamp).getTime();
        return timestamp >= sinceTimestamp
      })
      .reverse()
      .map(async (sale: any) => {
      const message = buildMessage(sale);

      const salePrice = ethers.utils.formatEther(sale.total_price || '0')
      if (
        mainChannel &&
        mainChannelMinSale &&
        parseFloat(mainChannelMinSale) <= parseFloat(salePrice)
      ) {
        await mainChannel.send(message);
      }

      return salesChannel.send(message)
    })
  );
}

main()
  .then((res) => {
    if (!res.length) console.log("No recent sales")
    process.exit(0)
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
